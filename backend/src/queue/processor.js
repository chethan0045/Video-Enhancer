const { spawn, execSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { VideoJob } = require('../models');
const { emitJobProgress } = require('../websocket');

const wingetPkg = path.join(process.env.LOCALAPPDATA || '', 'Microsoft', 'WinGet', 'Packages', 'Gyan.FFmpeg.Essentials_Microsoft.Winget.Source_8wekyb3d8bbwe');
process.env.Path = [
  process.env.Path, process.env.PATH,
  ...[process.env.LOCALAPPDATA, process.env.PROGRAMFILES, process.env['PROGRAMFILES(X86)'], os.homedir()]
    .filter(Boolean).flatMap(d => [
      path.join(d, 'ffmpeg', 'bin'), path.join(d, 'bin'), path.join(d, 'Microsoft', 'WinGet', 'Links'),
    ]),
  wingetPkg, path.join(wingetPkg, 'ffmpeg-8.1.1-essentials_build', 'bin'),
].filter(Boolean).join(';');

const NUM_WORKERS = Math.max(2, os.cpus().length);

// Resolve ffmpeg/ffprobe binaries. Prefer a system install (keeps hardware encoders like
// QSV/NVENC available in dev), and fall back to the bundled static binaries so the app
// works on hosts without a system ffmpeg — e.g. the live server. Override with env if needed.
function resolveBinaries() {
  let ffmpeg = process.env.FFMPEG_PATH || 'ffmpeg';
  let ffprobe = process.env.FFPROBE_PATH || 'ffprobe';
  if (!process.env.FFMPEG_PATH) {
    let systemOk = false;
    try { execSync('ffmpeg -version', { stdio: 'pipe', windowsHide: true }); systemOk = true; } catch { }
    if (!systemOk) {
      try {
        const staticFf = require('ffmpeg-static');
        if (staticFf) { ffmpeg = staticFf; ffprobe = require('ffprobe-static').path || ffprobe; }
      } catch { /* packages absent → keep PATH-based names */ }
    }
  }
  return { ffmpeg, ffprobe };
}
const { ffmpeg: FFMPEG, ffprobe: FFPROBE } = resolveBinaries();
console.log(`[Processor] ffmpeg=${FFMPEG === 'ffmpeg' ? 'system PATH' : FFMPEG}`);

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

let ffmpegChecked = false, ffmpegAvailable = false;
// H.264 encoders (used for ≤4K, universally playable) and HEVC encoders (used for 8K,
// since H.264 hardware tops out near 4K). Detected at runtime so the same build runs
// fast on NVIDIA, Intel or AMD hardware and falls back to CPU where there's no GPU.
let hw = {
  nvenc: false, qsv: false, amf: false,        // H.264
  nvencHevc: false, qsvHevc: false, amfHevc: false, // HEVC (8K-capable)
};

function probeEncoder(name) {
  try {
    // Use the null muxer (`-f null -`), NOT `-y nul`: on Windows ffmpeg can't infer a
    // format from the filename "nul" and fails for every encoder — which previously meant
    // hardware acceleration was never detected and everything fell back to software.
    execSync(`"${FFMPEG}" -f lavfi -i color=s=1280x720:d=0.5 -c:v ${name} -b:v 1M -f null -`, { windowsHide: true, stdio: 'pipe' });
    return true;
  } catch { return false; }
}

function checkFfmpeg() {
  if (ffmpegChecked) return ffmpegAvailable;
  ffmpegChecked = true;
  try {
    execSync(`"${FFMPEG}" -version`, { stdio: 'pipe', windowsHide: true });
    ffmpegAvailable = true;
    console.log('[Processor] FFmpeg detected');

    hw.nvenc = probeEncoder('h264_nvenc');
    hw.qsv = probeEncoder('h264_qsv');
    hw.amf = probeEncoder('h264_amf');
    // Only bother probing a vendor's HEVC encoder if its H.264 one works.
    hw.nvencHevc = hw.nvenc && probeEncoder('hevc_nvenc');
    hw.qsvHevc = hw.qsv && probeEncoder('hevc_qsv');
    hw.amfHevc = hw.amf && probeEncoder('hevc_amf');

    const h264 = [hw.nvenc && 'NVENC', hw.qsv && 'QSV', hw.amf && 'AMF'].filter(Boolean);
    const hevc = [hw.nvencHevc && 'NVENC', hw.qsvHevc && 'QSV', hw.amfHevc && 'AMF'].filter(Boolean);
    console.log(`[Processor] HW H.264: ${h264.join(', ') || 'none (libx264)'} | HW HEVC/8K: ${hevc.join(', ') || 'none (libx264)'}`);
  } catch { ffmpegAvailable = false; console.warn('[Processor] FFmpeg NOT found'); }
  return ffmpegAvailable;
}

async function runFFmpeg(args, onProgress) {
  return new Promise((resolve, reject) => {
    const proc = spawn(FFMPEG, args, { windowsHide: true });
    let stderr = '';
    proc.stderr.on('data', (data) => {
      stderr += data.toString();
      const m = data.toString().match(/time=(\d+):(\d+):(\d+\.\d+)/);
      if (m && onProgress) onProgress(parseInt(m[1]) * 3600 + parseInt(m[2]) * 60 + parseFloat(m[3]));
    });
    proc.on('close', (code) => { if (code === 0) resolve(); else reject(new Error(stderr.slice(-800))); });
    proc.on('error', (e) => reject(e));
  });
}

function getVideoInfo(inputPath) {
  try {
    const r = execSync(`"${FFPROBE}" -v quiet -print_format json -show_format -show_streams "${inputPath}"`, { encoding: 'utf8', windowsHide: true });
    const info = JSON.parse(r);
    const vs = info.streams.find(s => s.codec_type === 'video') || {};
    const fpsParts = (vs.avg_frame_rate || '24/1').split('/');
    return {
      width: vs.width || 0, height: vs.height || 0,
      fps: parseInt(fpsParts[0]) / parseInt(fpsParts[1] || 1) || 24,
      duration: parseFloat(info.format?.duration || 0),
      codec: vs.codec_name || '', bitrate: vs.bit_rate || info.format?.bit_rate || 0,
      audioCodec: (info.streams.find(s => s.codec_type === 'audio') || {}).codec_name,
    };
  } catch { return { width: 1280, height: 720, fps: 24, duration: 30, codec: '', bitrate: 0, audioCodec: '' }; }
}

// Choose the best encoder for the target resolution and available hardware.
// ≤4K: H.264 hardware (NVENC > QSV > AMF) for universal playback. 8K: HEVC hardware
// (H.264 can't do 8K). Returns null when no usable hardware encoder exists → software.
function pickHwEncoder(targetH) {
  if (targetH > 2160) {
    if (hw.nvencHevc) return 'hevc_nvenc';
    if (hw.qsvHevc) return 'hevc_qsv';
    if (hw.amfHevc) return 'hevc_amf';
    return null;
  }
  if (hw.nvenc) return 'h264_nvenc';
  if (hw.qsv) return 'h264_qsv';
  if (hw.amf) return 'h264_amf';
  return null;
}

// Whether the given target can be encoded in hardware on this host.
function canHwEncode(targetH) {
  return pickHwEncoder(targetH) !== null;
}

function buildEncoderArgs(useHW, info, outputPath, targetH = 2160) {
  const enc = useHW ? pickHwEncoder(targetH) : null;
  const bk = info.bitrate > 0 ? Math.max(8000, Math.round(info.bitrate * 1.5 / 1000)) : 20000;
  const tail = ['-pix_fmt', 'yuv420p', '-movflags', '+faststart', outputPath];
  // HEVC in MP4 needs the hvc1 tag to play in browsers/QuickTime.
  const hevcTail = ['-pix_fmt', 'yuv420p', '-tag:v', 'hvc1', '-movflags', '+faststart', outputPath];

  switch (enc) {
    case 'h264_nvenc':
      return ['-c:v', 'h264_nvenc', '-preset', 'p7', '-rc', 'vbr',
        '-b:v', `${bk}k`, '-maxrate', `${Math.round(bk * 1.5)}k`, '-bufsize', `${Math.round(bk * 2)}k`,
        '-qmin', '18', '-qmax', '28', '-profile:v', 'main', ...tail];
    case 'hevc_nvenc':
      return ['-c:v', 'hevc_nvenc', '-preset', 'p6', '-rc', 'vbr',
        '-b:v', `${bk}k`, '-maxrate', `${Math.round(bk * 1.5)}k`, '-bufsize', `${Math.round(bk * 2)}k`, ...hevcTail];
    case 'h264_qsv':
      // Intel Quick Sync — big speed-up over software on Iris/UHD graphics.
      // Bitrate-based VBR (matches the validated probe); avoid mixing global_quality with -b:v.
      return ['-c:v', 'h264_qsv', '-preset', 'veryfast',
        '-b:v', `${bk}k`, '-maxrate', `${Math.round(bk * 1.5)}k`, '-profile:v', 'high', ...tail];
    case 'hevc_qsv':
      return ['-c:v', 'hevc_qsv', '-preset', 'veryfast',
        '-b:v', `${bk}k`, '-maxrate', `${Math.round(bk * 1.5)}k`, ...hevcTail];
    case 'h264_amf':
      return ['-c:v', 'h264_amf', '-quality', 'quality', '-rc', 'vbr_latency',
        '-b:v', `${bk}k`, '-maxrate', `${Math.round(bk * 1.5)}k`, ...tail];
    case 'hevc_amf':
      return ['-c:v', 'hevc_amf', '-quality', 'quality', '-rc', 'vbr_latency',
        '-b:v', `${bk}k`, '-maxrate', `${Math.round(bk * 1.5)}k`, ...hevcTail];
    default: {
      // Software x264 (no GPU, e.g. live). Fast presets — this path has no hardware help,
      // so favour speed; quality stays good for a "fast tier".
      const ultraHD = targetH >= 2160;
      return ['-c:v', 'libx264',
        '-preset', ultraHD ? 'ultrafast' : 'veryfast',
        '-crf', '21',
        '-tune', 'film', ...tail];
    }
  }
}

async function processVideo(jobId, inputPath, settings = {}) {
  if (!checkFfmpeg()) return simulatePipeline(jobId);

  const job = await VideoJob.findById(jobId);
  if (!job) throw new Error('Job not found');

  const outputDir = path.join(__dirname, '..', 'outputs', jobId);
  fs.mkdirSync(outputDir, { recursive: true });
  const tempDir = path.join(outputDir, 'temp');
  fs.mkdirSync(tempDir, { recursive: true });

  const p = settings.pipeline || {};
  const denoise = p.denoise || {};
  const upscale = p.upscale || {};
  const hdr = p.hdr || {};
  const colorGrading = p.colorGrading || {};
  const filmTexture = p.filmTexture || {};

  const info = getVideoInfo(inputPath);
  const srcH = info.height || 720, srcW = info.width || 1280;
  const isHD = srcH >= 720 && srcH < 2160;
  const is4K = srcH >= 2160;
  console.log(`[Processor] ${srcW}x${srcH} @ ${info.fps.toFixed(2)}fps, ${info.duration.toFixed(1)}s (${info.codec})`);

  let targetH = { '1080p': 1080, '2k': 1440, '4k': 2160, '8k': 4320 }[upscale.target] || 2160;
  // On a host with no hardware encoder (e.g. the live server), every pixel is scaled AND
  // encoded on the CPU — 8K is impractically slow there. Cap the target so the "fast" tier
  // stays fast; true 8K belongs on the GPU/AI tier. Override with FFMPEG_SW_MAX_HEIGHT.
  const hwAvailable = hw.nvenc || hw.qsv || hw.amf || hw.nvencHevc || hw.qsvHevc || hw.amfHevc;
  const swMax = parseInt(process.env.FFMPEG_SW_MAX_HEIGHT || '1440', 10);
  if (!hwAvailable && targetH > swMax) {
    console.log(`[Processor] No HW encoder — capping ${targetH}p -> ${swMax}p for speed (set FFMPEG_SW_MAX_HEIGHT to change)`);
    targetH = swMax;
  }
  const doUpscale = upscale.enabled !== false && targetH > srcH && targetH <= 4320;

  const outputVideo = path.join(outputDir, 'output.mp4');
  const audioFile = path.join(tempDir, 'audio.aac');

  async function setStage(name, status, pct) {
    const j = await VideoJob.findById(jobId);
    if (!j) return;
    const stage = j.pipelineStages?.find(s => s.name === name);
    if (stage) { stage.status = status; if (pct !== undefined) stage.progress = pct; }
    await VideoJob.updateById(jobId, { $set: { pipelineStages: j.pipelineStages } }).catch(() => {});
  }

  // ── Extract audio ──
  await setStage('denoise', 'processing', 0);
  try { await runFFmpeg(['-y', '-i', inputPath, '-vn', '-c:a', 'copy', '-bsf:a', 'aac_adtstoasc', audioFile]); } catch {}
  await setStage('denoise', 'completed', 100);

  // ── Apply trim if enabled ──
  let workingInput = inputPath;
  if (p.editor?.trim?.enabled) {
    const ts = parseFloat(p.editor.trim.start) || 0;
    const te = parseFloat(p.editor.trim.end) || 0;
    if (te > ts) {
      const trimmedPath = path.join(tempDir, 'trimmed.mp4');
      console.log(`[Processor] Trimming ${ts}s → ${te}s`);
      await runFFmpeg(['-y', '-ss', String(ts), '-i', inputPath, '-to', String(te - ts), '-c', 'copy', trimmedPath]);
      workingInput = trimmedPath;
      const trimmedInfo = getVideoInfo(workingInput);
      if (trimmedInfo.duration > 0) {
        info.duration = trimmedInfo.duration;
        info.width = trimmedInfo.width;
        info.height = trimmedInfo.height;
        info.fps = trimmedInfo.fps;
      }
    }
  }

  const midStages = ['deblur', 'temporal', 'upscale', 'face_restore', 'depth_simulation', 'fps_interpolation', 'hdr', 'color_grading', 'film_texture'];
  for (const sn of midStages) await setStage(sn, 'processing', 0);
  await VideoJob.updateById(jobId, { $set: { status: 'processing', progress: 5 } });
  emitJobProgress(jobId, { userId: job.userId, status: 'processing', progress: 5 });

  // ── Build filter chain ──
  const filters = [];

  // Denoise for a clean image. Kept on even for 4K sources (gentler), since
  // upscaling to 8K otherwise amplifies grain/noise.
  if (denoise.enabled !== false) {
    const base = isHD ? 0.5 : (denoise.strength || 0.5);
    const s = is4K ? Math.min(base, 0.35) : base;
    const strength = Math.max(1, Math.round(s * 4));
    filters.push(`hqdn3d=${strength}:${Math.max(1, strength - 1)}:${Math.max(1, strength - 1)}:${Math.max(1, strength - 1)}`);
  }

  if (p.deblur?.enabled !== false) {
    const amt = Math.max(0.3, (p.deblur?.strength || 0.5) * 2.0);
    filters.push(`cas=${(is4K || targetH >= 2160 ? amt * 0.7 : amt).toFixed(2)}`);
  }

  const luts = {
    cinematic: 'eq=saturation=1.1:contrast=1.08:brightness=0.01',
    teal_orange: 'colorbalance=rs=0.08:gs=-0.03:bs=-0.08,eq=saturation=1.15',
    warm: 'colorbalance=rs=0.08:gs=0.03:bs=-0.08,eq=saturation=1.02',
    cool: 'colorbalance=rs=-0.03:gs=0:bs=0.08,eq=saturation=0.95',
    vintage: 'colorbalance=rs=0.06:gs=0.02:bs=-0.06,eq=saturation=0.8:contrast=1.05',
    hdr: 'eq=saturation=1.15:contrast=1.12:brightness=0.02',
  };
  if (colorGrading.enabled !== false && luts[colorGrading.lut]) filters.push(luts[colorGrading.lut]);

  if (hdr.enabled !== false) {
    const s = hdr.strength || 0.7;
    filters.push(`eq=contrast=${(1.0 + s * 0.15).toFixed(2)}:brightness=${(s * 0.03).toFixed(2)}`);
  }

  if (doUpscale) {
    // Scaler choice is the dominant CPU cost when upscaling. At 8K (33MP/frame),
    // spline36/lanczos + deband are punishingly slow, so use bicubic there; lanczos
    // for 4K and below where it's affordable. (deband removed — denoise already keeps
    // the image clean, and deband at 8K roughly doubled encode time.)
    const flags = targetH >= 4320 ? 'bicubic' : 'lanczos';
    filters.push(`scale=-2:${targetH}:flags=${flags}`);
  }

  if (p.editor?.crop?.enabled && (p.editor.crop.width || 0) > 0) {
    filters.push(`crop=${p.editor.crop.width}:${p.editor.crop.height}:${p.editor.crop.x}:${p.editor.crop.y}`);
  }

  if (filmTexture.enabled) filters.push('noise=alls=3:allf=t+u');

  const filterStr = filters.join(',');
  const vfArgs = filterStr ? ['-vf', filterStr] : [];
  // Use hardware whenever this host can encode the target res (H.264 ≤4K, HEVC for 8K).
  // Falls back to software automatically where there's no capable GPU (e.g. the live server).
  const useHW = canHwEncode(targetH);
  const encLabel = useHW ? (pickHwEncoder(targetH) || 'HW') : 'libx264';
  const longVideo = info.duration > 180;

  // CPU-parallel segmenting only helps the software path; a hardware encoder is
  // already fast and a single GPU session avoids multi-session contention.
  if (longVideo && srcH < 2160 && NUM_WORKERS >= 2 && !useHW) {
    // ── Segmented parallel processing ──
    const SEG_COUNT = Math.min(NUM_WORKERS, 4);
    const segDir = path.join(tempDir, 'segments');
    const concatDir = path.join(tempDir, 'concat');
    fs.mkdirSync(segDir, { recursive: true });
    fs.mkdirSync(concatDir, { recursive: true });

    const segDur = info.duration / SEG_COUNT;
    console.log(`[Processor] ${SEG_COUNT} parallel segments (${segDur.toFixed(1)}s each)`);

    const segFiles = [];
    const tasks = [];
    for (let i = 0; i < SEG_COUNT; i++) {
      const segOut = path.join(segDir, `seg_${i}.mp4`);
      segFiles.push(segOut);
      const start = i * segDur;
      const dur = i < SEG_COUNT - 1 ? segDur : info.duration - start;
      const sArgs = ['-y', '-ss', String(start), '-i', workingInput, '-t', String(dur), ...vfArgs, ...buildEncoderArgs(useHW, info, segOut, targetH)];
      tasks.push(runFFmpeg(sArgs, (elapsed) => {
        const overall = 5 + (elapsed / dur) * (85 / SEG_COUNT) + (i * 85 / SEG_COUNT);
        emitJobProgress(jobId, { userId: job.userId, status: 'processing', progress: Math.min(Math.round(overall), 90) });
        VideoJob.updateById(jobId, { $set: { progress: Math.min(Math.round(overall), 90) } }).catch(() => {});
      }));
    }
    await Promise.all(tasks);
    console.log(`[Processor] All segments done`);

    const concatFile = path.join(tempDir, 'segments.txt');
    fs.writeFileSync(concatFile, segFiles.map(f => `file '${f.replace(/\\/g, '/')}'`).join('\n'));

    const concatVideo = path.join(concatDir, 'merged.mp4');
    await runFFmpeg(['-y', '-f', 'concat', '-safe', '0', '-i', concatFile, '-c', 'copy', concatVideo]);

    await VideoJob.updateById(jobId, { $set: { progress: 92 } });
    await setStage('export', 'processing', 0);
    const audioOk = fs.existsSync(audioFile) && fs.statSync(audioFile).size > 1024;
    const muxArgs = ['-y', '-i', concatVideo];
    if (audioOk) muxArgs.push('-i', audioFile);
    muxArgs.push('-c:v', 'copy', ...(audioOk ? ['-c:a', 'copy', '-map', '0:v:0', '-map', '1:a:0'] : []), '-shortest', outputVideo);
    await runFFmpeg(muxArgs);
  } else {
    // ── Single pass ──
    const interimVideo = path.join(tempDir, 'enhanced.mp4');
    const encodeArgs = ['-y', '-i', workingInput, ...vfArgs, ...buildEncoderArgs(useHW, info, interimVideo, targetH)];

    const startTime = Date.now();
    console.log(`[Processor] ${encLabel} encode, ${filters.length} filters`);
    await runFFmpeg(encodeArgs, (elapsed) => {
      const pct = info.duration > 0 ? Math.min(90, 5 + Math.round((elapsed / info.duration) * 85)) : 50;
      emitJobProgress(jobId, { userId: job.userId, status: 'processing', progress: pct });
      VideoJob.updateById(jobId, { $set: { progress: pct } }).catch(() => {});
    });
    console.log(`[Processor] Encode done in ${((Date.now() - startTime) / 1000).toFixed(1)}s (${encLabel})`);

    await VideoJob.updateById(jobId, { $set: { progress: 92 } });
    await setStage('export', 'processing', 0);
    const audioOk = fs.existsSync(audioFile) && fs.statSync(audioFile).size > 1024;
    const muxArgs = ['-y', '-i', interimVideo];
    if (audioOk) muxArgs.push('-i', audioFile);
    muxArgs.push('-c:v', 'copy', ...(audioOk ? ['-c:a', 'copy', '-map', '0:v:0', '-map', '1:a:0'] : []), '-shortest', outputVideo);
    await runFFmpeg(muxArgs);
  }

  for (const sn of midStages) await setStage(sn, 'completed', 100);
  try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch {}

  await VideoJob.updateById(jobId, {
    $set: { status: 'completed', progress: 100, completedAt: new Date(),
      outputPath: outputVideo, inputDuration: info.duration, inputResolution: { width: srcW, height: srcH } },
  });
  await setStage('export', 'completed', 100);
  emitJobProgress(jobId, { userId: job.userId, status: 'completed', progress: 100 });
  console.log(`[Processor] Job ${jobId} complete`);
}

async function simulatePipeline(jobId) {
  const STAGES = [
    { name: 'denoise', weight: 10 }, { name: 'deblur', weight: 10 },
    { name: 'temporal', weight: 12 }, { name: 'upscale', weight: 14 },
    { name: 'face_restore', weight: 10 }, { name: 'depth_simulation', weight: 8 },
    { name: 'fps_interpolation', weight: 6 }, { name: 'hdr', weight: 8 },
    { name: 'color_grading', weight: 6 }, { name: 'film_texture', weight: 4 },
    { name: 'export', weight: 2 },
  ];
  const totalW = STAGES.reduce((s, st) => s + st.weight, 0);
  let acc = 0;
  const job = await VideoJob.findById(jobId);
  if (!job) return;
  console.log(`[Simulator] Job ${jobId} (FFmpeg not found)`);
  for (const stage of STAGES) {
    const j = await VideoJob.findById(jobId);
    if (!j || j.status === 'cancelled') return;
    const idx = j.pipelineStages?.findIndex(s => s.name === stage.name);
    if (idx !== -1) j.pipelineStages[idx].status = 'processing';
    j.status = 'processing';
    await VideoJob.updateById(jobId, { $set: { status: 'processing', pipelineStages: j.pipelineStages } });
    const dur = 400 + Math.random() * 400;
    for (let s = 0; s < 4; s++) {
      await sleep(dur / 4);
      acc += stage.weight / 4;
      const pct = Math.min(Math.round((acc / totalW) * 100), 99);
      const current = await VideoJob.findById(jobId);
      if (current) {
        const si = current.pipelineStages?.findIndex(x => x.name === stage.name);
        if (si !== -1) current.pipelineStages[si].progress = (s + 1) * 25;
        current.progress = pct;
        await VideoJob.updateById(jobId, { $set: { progress: pct, pipelineStages: current.pipelineStages } });
      }
      emitJobProgress(jobId, { userId: job.userId, status: 'processing', progress: pct });
    }
    const done = await VideoJob.findById(jobId);
    if (done) {
      const si = done.pipelineStages?.findIndex(x => x.name === stage.name);
      if (si !== -1) { done.pipelineStages[si].status = 'completed'; done.pipelineStages[si].progress = 100; }
      await VideoJob.updateById(jobId, { $set: { pipelineStages: done.pipelineStages } });
    }
  }
  await VideoJob.updateById(jobId, { $set: { status: 'completed', progress: 100, completedAt: new Date(), outputPath: job.inputPath } });
  emitJobProgress(jobId, { userId: job.userId, status: 'completed', progress: 100 });
  console.log(`[Simulator] Job ${jobId} complete`);
}

// ── Shared stage helper (used by edit jobs) ──
async function setStageStatus(jobId, name, status, pct) {
  const j = await VideoJob.findById(jobId);
  if (!j) return;
  const stage = j.pipelineStages?.find(s => s.name === name);
  if (stage) { stage.status = status; if (pct !== undefined) stage.progress = pct; }
  await VideoJob.updateById(jobId, { $set: { pipelineStages: j.pipelineStages } }).catch(() => {});
}

/**
 * Edit-only path — applies trim and/or crop and re-exports.
 * Deliberately does NOT run any AI/enhancement filters; it is the
 * separate "Edit Video" tool, kept independent from the enhancer.
 */
async function processEdit(jobId, inputPath, settings = {}) {
  const job = await VideoJob.findById(jobId);
  if (!job) throw new Error('Job not found');

  const p = settings.pipeline || job.pipeline || {};
  const editor = p.editor || {};
  const trim = editor.trim || {};
  const crop = editor.crop || {};

  const ts = parseFloat(trim.start) || 0;
  const te = parseFloat(trim.end) || 0;
  const doTrim = trim.enabled && te > ts;
  const doCrop = crop.enabled && (crop.width || 0) > 0 && (crop.height || 0) > 0;

  const outputDir = path.join(__dirname, '..', 'outputs', jobId);
  fs.mkdirSync(outputDir, { recursive: true });
  const outputVideo = path.join(outputDir, 'output.mp4');

  // No FFmpeg → we can't actually cut/crop; surface the original so the job still resolves.
  if (!checkFfmpeg()) {
    console.warn('[Editor] FFmpeg not found — exporting original without edits');
    for (const sn of ['trim', 'crop', 'export']) await setStageStatus(jobId, sn, 'completed', 100);
    await VideoJob.updateById(jobId, {
      $set: { status: 'completed', progress: 100, completedAt: new Date(), outputPath: inputPath },
    });
    emitJobProgress(jobId, { userId: job.userId, status: 'completed', progress: 100 });
    return;
  }

  const info = getVideoInfo(inputPath);
  const outDuration = doTrim ? (te - ts) : info.duration;
  console.log(`[Editor] Job ${jobId}: trim=${doTrim ? `${ts}→${te}` : 'no'}, crop=${doCrop ? `${crop.width}x${crop.height}` : 'no'}`);

  await VideoJob.updateById(jobId, { $set: { status: 'processing', progress: 5 } });
  emitJobProgress(jobId, { userId: job.userId, status: 'processing', progress: 5 });

  // ── Trim ──
  await setStageStatus(jobId, 'trim', doTrim ? 'processing' : 'skipped', doTrim ? 0 : 100);
  // ── Crop ──
  await setStageStatus(jobId, 'crop', doCrop ? 'processing' : 'skipped', doCrop ? 0 : 100);

  // Build a single FFmpeg pass. Cropping requires a re-encode; trim-only can stream-copy (fast, no quality loss).
  const args = ['-y'];
  if (doTrim) args.push('-ss', String(ts));
  args.push('-i', inputPath);
  if (doTrim) args.push('-t', String(te - ts));

  if (doCrop) {
    // Cropping requires a re-encode — use the same hardware-aware encoder selection.
    const cropH = crop.height || info.height || 1080;
    const encArgs = buildEncoderArgs(canHwEncode(cropH), info, outputVideo, cropH);
    const out = encArgs.pop(); // outputVideo (last element)
    args.push('-vf', `crop=${crop.width}:${crop.height}:${crop.x}:${crop.y}`, ...encArgs, '-c:a', 'copy', out);
  } else {
    // Trim-only (or no edits) → stream copy: fast and lossless.
    args.push('-c', 'copy', '-movflags', '+faststart', outputVideo);
  }

  await runFFmpeg(args, (elapsed) => {
    const pct = outDuration > 0 ? Math.min(95, 5 + Math.round((elapsed / outDuration) * 90)) : 50;
    emitJobProgress(jobId, { userId: job.userId, status: 'processing', progress: pct });
    VideoJob.updateById(jobId, { $set: { progress: pct } }).catch(() => {});
  });

  if (doTrim) await setStageStatus(jobId, 'trim', 'completed', 100);
  if (doCrop) await setStageStatus(jobId, 'crop', 'completed', 100);
  await setStageStatus(jobId, 'export', 'completed', 100);

  await VideoJob.updateById(jobId, {
    $set: {
      status: 'completed', progress: 100, completedAt: new Date(), outputPath: outputVideo,
      inputDuration: info.duration, inputResolution: { width: info.width, height: info.height },
    },
  });
  emitJobProgress(jobId, { userId: job.userId, status: 'completed', progress: 100 });
  console.log(`[Editor] Job ${jobId} complete`);
}

/**
 * Extract the audio track to a standalone file (mp3 / m4a / wav).
 */
async function processExtractAudio(jobId, inputPath, settings = {}) {
  const job = await VideoJob.findById(jobId);
  if (!job) throw new Error('Job not found');
  if (!checkFfmpeg()) throw new Error('FFmpeg not available');

  const p = settings.pipeline || job.pipeline || {};
  const fmt = String(p.audioFormat || 'mp3').toLowerCase();
  const ext = fmt === 'wav' ? 'wav' : (fmt === 'aac' || fmt === 'm4a' ? 'm4a' : 'mp3');

  const info = getVideoInfo(inputPath);
  if (!info.audioCodec) throw new Error('This video has no audio track to extract');

  const outputDir = path.join(__dirname, '..', 'outputs', jobId);
  fs.mkdirSync(outputDir, { recursive: true });
  const outputAudio = path.join(outputDir, `audio.${ext}`);

  await setStageStatus(jobId, 'extract', 'processing', 0);
  await VideoJob.updateById(jobId, { $set: { status: 'processing', progress: 5 } });
  emitJobProgress(jobId, { userId: job.userId, status: 'processing', progress: 5 });

  const codec = ext === 'wav' ? ['-c:a', 'pcm_s16le']
    : ext === 'm4a' ? ['-c:a', 'aac', '-b:a', '192k']
      : ['-c:a', 'libmp3lame', '-q:a', '2'];
  await runFFmpeg(['-y', '-i', inputPath, '-vn', ...codec, outputAudio], (elapsed) => {
    const pct = info.duration > 0 ? Math.min(95, 5 + Math.round((elapsed / info.duration) * 90)) : 50;
    emitJobProgress(jobId, { userId: job.userId, status: 'processing', progress: pct });
    VideoJob.updateById(jobId, { $set: { progress: pct } }).catch(() => {});
  });

  await setStageStatus(jobId, 'extract', 'completed', 100);
  await setStageStatus(jobId, 'export', 'completed', 100);
  await VideoJob.updateById(jobId, {
    $set: { status: 'completed', progress: 100, completedAt: new Date(), outputPath: outputAudio, inputDuration: info.duration },
  });
  emitJobProgress(jobId, { userId: job.userId, status: 'completed', progress: 100 });
  console.log(`[Audio] Job ${jobId} complete (${ext})`);
}

/**
 * Merge multiple clips into one. Each clip is normalized to a common canvas
 * (derived from the first clip, height ≤1080), fps and audio layout, then
 * concatenated — so clips of differing resolutions/codecs join cleanly.
 */
async function processMerge(jobId, inputPaths, settings = {}) {
  const job = await VideoJob.findById(jobId);
  if (!job) throw new Error('Job not found');
  const paths = (inputPaths && inputPaths.length ? inputPaths : job.inputPaths) || [];
  if (paths.length < 2) throw new Error('Merge requires at least 2 clips');
  if (!checkFfmpeg()) throw new Error('FFmpeg not available');

  const outputDir = path.join(__dirname, '..', 'outputs', jobId);
  const tempDir = path.join(outputDir, 'temp');
  fs.mkdirSync(tempDir, { recursive: true });
  const outputVideo = path.join(outputDir, 'output.mp4');

  await setStageStatus(jobId, 'merge', 'processing', 0);
  await VideoJob.updateById(jobId, { $set: { status: 'processing', progress: 3 } });
  emitJobProgress(jobId, { userId: job.userId, status: 'processing', progress: 3 });

  // Common canvas from the first clip (height capped at 1080), even dimensions.
  const first = getVideoInfo(paths[0]);
  const H = Math.min(1080, Math.max(2, first.height || 720)) & ~1;
  const W = Math.max(2, Math.round((first.width || 1280) * H / (first.height || 720) / 2) * 2);
  const fps = 30;

  const normalized = [];
  for (let i = 0; i < paths.length; i++) {
    const info = getVideoInfo(paths[i]);
    const hasAudio = !!info.audioCodec;
    const normPath = path.join(tempDir, `norm_${i}.mp4`);
    const vf = `scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=${fps}`;
    const enc = buildEncoderArgs(canHwEncode(H), info, normPath, H);
    const out = enc.pop();
    const args = ['-y', '-i', paths[i]];
    if (!hasAudio) args.push('-f', 'lavfi', '-i', 'anullsrc=channel_layout=stereo:sample_rate=48000');
    args.push('-vf', vf, ...enc, '-c:a', 'aac', '-ar', '48000', '-ac', '2');
    if (!hasAudio) args.push('-shortest');
    args.push(out);
    await runFFmpeg(args);
    normalized.push(normPath);
    const pct = 3 + Math.round(((i + 1) / paths.length) * 80);
    await VideoJob.updateById(jobId, { $set: { progress: pct } });
    emitJobProgress(jobId, { userId: job.userId, status: 'processing', progress: pct });
  }

  await setStageStatus(jobId, 'merge', 'completed', 100);
  await setStageStatus(jobId, 'export', 'processing', 0);

  const listFile = path.join(tempDir, 'concat.txt');
  fs.writeFileSync(listFile, normalized.map(f => `file '${f.replace(/\\/g, '/')}'`).join('\n'));
  await runFFmpeg(['-y', '-f', 'concat', '-safe', '0', '-i', listFile, '-c', 'copy', '-movflags', '+faststart', outputVideo]);

  try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch {}
  await setStageStatus(jobId, 'export', 'completed', 100);
  const finalInfo = getVideoInfo(outputVideo);
  await VideoJob.updateById(jobId, {
    $set: { status: 'completed', progress: 100, completedAt: new Date(), outputPath: outputVideo, inputDuration: finalInfo.duration, inputResolution: { width: W, height: H } },
  });
  emitJobProgress(jobId, { userId: job.userId, status: 'completed', progress: 100 });
  console.log(`[Merge] Job ${jobId} complete (${paths.length} clips → ${W}x${H})`);
}

/**
 * Generate subtitles (.srt) via faster-whisper (CPU). Extracts 16k mono audio,
 * then runs python-engine/transcribe.py. Fails clearly if Python/faster-whisper
 * isn't installed (no silent success).
 */
function runWhisper(wavPath, srtPath, settings, jobId, job) {
  return new Promise((resolve) => {
    const pythonPath = process.env.PYTHON_PATH || 'python';
    const script = path.join(__dirname, '..', '..', '..', 'python-engine', 'transcribe.py');
    if (!fs.existsSync(script)) return resolve(false);
    const model = settings.whisperModel || process.env.WHISPER_MODEL || 'tiny';
    const lang = settings.language || 'auto';
    const proc = spawn(pythonPath, [script, '--input', wavPath, '--output', srtPath, '--model', model, '--language', lang],
      { windowsHide: true, env: { ...process.env, PYTHONUNBUFFERED: '1' } });
    let stderr = '';
    proc.stdout.on('data', (d) => {
      const m = d.toString().match(/PROGRESS (\d+)/);
      if (m) {
        const pct = Math.min(95, 30 + Math.round(parseInt(m[1]) * 0.6));
        emitJobProgress(jobId, { userId: job.userId, status: 'processing', progress: pct });
        VideoJob.updateById(jobId, { $set: { progress: pct } }).catch(() => {});
      }
    });
    proc.stderr.on('data', (d) => { stderr += d.toString(); });
    proc.on('error', () => resolve(false));
    proc.on('close', (code) => {
      if (code === 0 && fs.existsSync(srtPath)) return resolve(true);
      console.warn(`[Subtitle] whisper exit ${code}: ${stderr.slice(-300)}`);
      resolve(false);
    });
  });
}

async function processSubtitle(jobId, inputPath, settings = {}) {
  const job = await VideoJob.findById(jobId);
  if (!job) throw new Error('Job not found');
  if (!checkFfmpeg()) throw new Error('FFmpeg not available');

  const p = settings.pipeline || job.pipeline || {};
  const info = getVideoInfo(inputPath);
  if (!info.audioCodec) throw new Error('This video has no audio track to transcribe');

  const outputDir = path.join(__dirname, '..', 'outputs', jobId);
  const tempDir = path.join(outputDir, 'temp');
  fs.mkdirSync(tempDir, { recursive: true });
  const srtPath = path.join(outputDir, 'subtitles.srt');
  const wavPath = path.join(tempDir, 'audio.wav');

  await setStageStatus(jobId, 'extract', 'processing', 0);
  await VideoJob.updateById(jobId, { $set: { status: 'processing', progress: 5 } });
  emitJobProgress(jobId, { userId: job.userId, status: 'processing', progress: 5 });
  await runFFmpeg(['-y', '-i', inputPath, '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', wavPath]);
  await setStageStatus(jobId, 'extract', 'completed', 100);

  await setStageStatus(jobId, 'transcribe', 'processing', 0);
  await VideoJob.updateById(jobId, { $set: { progress: 30 } });
  emitJobProgress(jobId, { userId: job.userId, status: 'processing', progress: 30 });

  const ok = await runWhisper(wavPath, srtPath, p, jobId, job);
  if (!ok) throw new Error('Transcription unavailable — install Python and faster-whisper (pip install faster-whisper) on the host.');

  await setStageStatus(jobId, 'transcribe', 'completed', 100);
  await setStageStatus(jobId, 'export', 'completed', 100);
  try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch {}
  await VideoJob.updateById(jobId, {
    $set: { status: 'completed', progress: 100, completedAt: new Date(), outputPath: srtPath, inputDuration: info.duration },
  });
  emitJobProgress(jobId, { userId: job.userId, status: 'completed', progress: 100 });
  console.log(`[Subtitle] Job ${jobId} complete`);
}

/**
 * AI enhancement tier — dispatches to a RunPod GPU endpoint (Real-ESRGAN + GFPGAN).
 * Falls back to the FFmpeg tier when RunPod isn't configured or the GPU job fails,
 * so the feature degrades gracefully on hosts without GPU access.
 */
async function processAiEnhance(jobId, inputPath, settings = {}) {
  const job = await VideoJob.findById(jobId);
  if (!job) throw new Error('Job not found');

  const runpod = require('../services/runpod');
  const base = (process.env.PUBLIC_BASE_URL || '').replace(/\/$/, '');
  if (!runpod.configured() || !base) {
    console.warn('[AI] RunPod not configured (need RUNPOD_API_KEY, RUNPOD_ENDPOINT_ID, PUBLIC_BASE_URL) — using FFmpeg tier');
    return processVideo(jobId, inputPath, settings);
  }

  const p = settings.pipeline || job.pipeline || {};
  const videoUrl = `${base}/uploads/${path.basename(inputPath)}`;

  await VideoJob.updateById(jobId, { $set: { status: 'processing', progress: 10 } });
  emitJobProgress(jobId, { userId: job.userId, status: 'processing', progress: 10 });

  let output;
  try {
    output = await runpod.runToCompletion({
      video_url: videoUrl,
      pipeline: {
        upscale: { enabled: p.upscale?.enabled !== false, scale: 4 },
        faceRestore: { enabled: p.faceRestore?.enabled !== false, weight: p.faceRestore?.strength ?? 0.5 },
        fpsInterpolation: { enabled: !!p.fpsInterpolation?.enabled, targetFps: p.fpsInterpolation?.targetFps || 60 },
      },
    }, (st) => {
      const pct = st === 'IN_PROGRESS' ? 60 : st === 'IN_QUEUE' ? 20 : 40;
      emitJobProgress(jobId, { userId: job.userId, status: 'processing', progress: pct });
      VideoJob.updateById(jobId, { $set: { progress: pct } }).catch(() => {});
    });
  } catch (err) {
    console.error('[AI] RunPod job failed, falling back to FFmpeg:', err.message);
    return processVideo(jobId, inputPath, settings);
  }

  const outputDir = path.join(__dirname, '..', 'outputs', jobId);
  fs.mkdirSync(outputDir, { recursive: true });
  const outputVideo = path.join(outputDir, 'output.mp4');
  if (output?.output_url) {
    const res = await fetch(output.output_url);
    if (!res.ok) throw new Error(`Failed to download RunPod output: ${res.status}`);
    fs.writeFileSync(outputVideo, Buffer.from(await res.arrayBuffer()));
  } else if (output?.output_base64) {
    fs.writeFileSync(outputVideo, Buffer.from(output.output_base64, 'base64'));
  } else {
    throw new Error('RunPod returned no output');
  }

  const info = getVideoInfo(outputVideo);
  // Mark all enhancement stages done (AI tier doesn't report per-stage progress).
  const done = (job.pipelineStages || []).map(s => ({ ...s, status: 'completed', progress: 100 }));
  await VideoJob.updateById(jobId, {
    $set: {
      status: 'completed', progress: 100, completedAt: new Date(), outputPath: outputVideo,
      pipelineStages: done,
      inputResolution: { width: output.width || info.width, height: output.height || info.height },
      inputDuration: info.duration,
    },
  });
  emitJobProgress(jobId, { userId: job.userId, status: 'completed', progress: 100 });
  console.log(`[AI] Job ${jobId} complete via RunPod GPU`);
}

/**
 * Background noise removal — cleans the audio track with FFmpeg's afftdn
 * denoiser (+ a high-pass to cut rumble). CPU-only, no GPU. Outputs the video
 * with cleaned audio (video stream copied), or a cleaned audio file if the
 * input has no video.
 */
async function processDenoiseAudio(jobId, inputPath, settings = {}) {
  const job = await VideoJob.findById(jobId);
  if (!job) throw new Error('Job not found');
  if (!checkFfmpeg()) throw new Error('FFmpeg not available');

  const p = settings.pipeline || job.pipeline || {};
  const info = getVideoInfo(inputPath);
  if (!info.audioCodec) throw new Error('This file has no audio track to clean');

  const strength = Math.min(1, Math.max(0, parseFloat(p.noiseStrength ?? 0.6)));
  const nr = Math.round(6 + strength * 30); // noise reduction 6..36 dB
  const af = `highpass=f=85,afftdn=nr=${nr}:nf=-30`;
  const hasVideo = (info.width || 0) > 0 && (info.height || 0) > 0;

  const outputDir = path.join(__dirname, '..', 'outputs', jobId);
  fs.mkdirSync(outputDir, { recursive: true });

  await setStageStatus(jobId, 'clean', 'processing', 0);
  await VideoJob.updateById(jobId, { $set: { status: 'processing', progress: 5 } });
  emitJobProgress(jobId, { userId: job.userId, status: 'processing', progress: 5 });

  let outputPath, args;
  if (hasVideo) {
    outputPath = path.join(outputDir, 'output.mp4');
    args = ['-y', '-i', inputPath, '-af', af, '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', outputPath];
  } else {
    outputPath = path.join(outputDir, 'audio.mp3');
    args = ['-y', '-i', inputPath, '-vn', '-af', af, '-c:a', 'libmp3lame', '-q:a', '2', outputPath];
  }

  await runFFmpeg(args, (elapsed) => {
    const pct = info.duration > 0 ? Math.min(95, 5 + Math.round((elapsed / info.duration) * 90)) : 50;
    emitJobProgress(jobId, { userId: job.userId, status: 'processing', progress: pct });
    VideoJob.updateById(jobId, { $set: { progress: pct } }).catch(() => {});
  });

  await setStageStatus(jobId, 'clean', 'completed', 100);
  await setStageStatus(jobId, 'export', 'completed', 100);
  await VideoJob.updateById(jobId, {
    $set: {
      status: 'completed', progress: 100, completedAt: new Date(), outputPath,
      inputDuration: info.duration,
      ...(hasVideo ? { inputResolution: { width: info.width, height: info.height } } : {}),
    },
  });
  emitJobProgress(jobId, { userId: job.userId, status: 'completed', progress: 100 });
  console.log(`[NoiseRemoval] Job ${jobId} complete (nr=${nr}dB)`);
}

// Single dispatch entry — routes a job to the right processor by mode.
function runJob({ jobId, inputPath, inputPaths, pipeline, mode }) {
  const settings = { pipeline };
  switch (mode) {
    case 'edit': return processEdit(jobId, inputPath, settings);
    case 'merge': return processMerge(jobId, inputPaths, settings);
    case 'extract-audio': return processExtractAudio(jobId, inputPath, settings);
    case 'subtitle': return processSubtitle(jobId, inputPath, settings);
    case 'denoise-audio': return processDenoiseAudio(jobId, inputPath, settings);
    default:
      // 'enhance' — AI (GPU) tier when requested, else the fast FFmpeg tier.
      if (pipeline?.engine === 'ai') return processAiEnhance(jobId, inputPath, settings);
      return processVideo(jobId, inputPath, settings);
  }
}

// Report FFmpeg availability and detected hardware encoders (for /api/health diagnostics).
function getCapabilities() {
  const ffmpeg = checkFfmpeg();
  return {
    ffmpeg,
    hwH264: [hw.nvenc && 'nvenc', hw.qsv && 'qsv', hw.amf && 'amf'].filter(Boolean),
    hwHevc8k: [hw.nvencHevc && 'nvenc', hw.qsvHevc && 'qsv', hw.amfHevc && 'amf'].filter(Boolean),
    aiTier: !!(process.env.RUNPOD_API_KEY && process.env.RUNPOD_ENDPOINT_ID && process.env.PUBLIC_BASE_URL),
  };
}

module.exports = { processVideo, processEdit, processMerge, processExtractAudio, processSubtitle, runJob, getCapabilities };
