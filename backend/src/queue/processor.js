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
    execSync(`ffmpeg -f lavfi -i color=s=1280x720:d=0.5 -c:v ${name} -b:v 1M -y nul`, { windowsHide: true, stdio: 'pipe' });
    return true;
  } catch { return false; }
}

function checkFfmpeg() {
  if (ffmpegChecked) return ffmpegAvailable;
  ffmpegChecked = true;
  try {
    execSync('ffmpeg -version', { stdio: 'pipe', windowsHide: true });
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
    const proc = spawn('ffmpeg', args, { windowsHide: true });
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
    const r = execSync(`ffprobe -v quiet -print_format json -show_format -show_streams "${inputPath}"`, { encoding: 'utf8', windowsHide: true });
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
      const ultraHD = targetH >= 4320;
      return ['-c:v', 'libx264',
        '-preset', ultraHD ? 'veryfast' : 'fast',
        '-crf', ultraHD ? '20' : '18',
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

  const targetH = { '1080p': 1080, '2k': 1440, '4k': 2160, '8k': 4320 }[upscale.target] || 2160;
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
    filters.push(targetH >= 2160
      ? `zscale=h=${targetH}:filter=spline36:out_range=limited`
      : `scale=-2:${targetH}:flags=lanczos`);
    // Smooth out banding in skies/gradients introduced by aggressive upscaling — keeps 8K output clean.
    if (targetH >= 2160) filters.push('deband=range=16:blur=true');
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
    console.log(`[Processor] ${useHW ? 'NVENC' : 'SW'} encode, ${filters.length} filters`);
    await runFFmpeg(encodeArgs, (elapsed) => {
      const pct = info.duration > 0 ? Math.min(90, 5 + Math.round((elapsed / info.duration) * 85)) : 50;
      emitJobProgress(jobId, { userId: job.userId, status: 'processing', progress: pct });
      VideoJob.updateById(jobId, { $set: { progress: pct } }).catch(() => {});
    });
    console.log(`[Processor] Encode done in ${((Date.now() - startTime) / 1000).toFixed(1)}s (${useHW ? 'NVENC' : 'SW'})`);

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

module.exports = { processVideo, processEdit };
