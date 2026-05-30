/**
 * Pure-Node speech-to-text via Transformers.js (Whisper on onnxruntime-node).
 * No Python required — runs on any Node host, including Render. Replaces the
 * old python-engine/transcribe.py path for the subtitle tool.
 */
const asrCache = {}; // one entry per model (don't cache rejected loads)

async function getAsr(model) {
  if (asrCache[model]) return asrCache[model];
  const { pipeline, env } = await import('@huggingface/transformers');
  env.allowLocalModels = false; // pull the model from the HF hub (cached after first use)
  // Retry a few times — model downloads from HuggingFace can transiently "fetch failed".
  let lastErr;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const p = await pipeline('automatic-speech-recognition', model);
      asrCache[model] = p;
      return p;
    } catch (e) {
      lastErr = e;
      if (attempt < 2) await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
    }
  }
  throw lastErr;
}

function srtTime(t) {
  if (!isFinite(t) || t < 0) t = 0;
  const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = Math.floor(t % 60);
  const ms = Math.round((t - Math.floor(t)) * 1000);
  const p = (n, w = 2) => String(n).padStart(w, '0');
  return `${p(h)}:${p(m)}:${p(s)},${p(ms, 3)}`;
}

function chunksToSrt(chunks) {
  let out = '', i = 1;
  for (const c of chunks) {
    const text = (c.text || '').trim();
    if (!text) continue;
    const start = (c.timestamp && c.timestamp[0] != null) ? c.timestamp[0] : 0;
    const end = (c.timestamp && c.timestamp[1] != null) ? c.timestamp[1] : start + 2;
    out += `${i++}\n${srtTime(start)} --> ${srtTime(end)}\n${text}\n\n`;
  }
  return out;
}

/**
 * @param {Float32Array} pcm  16 kHz mono samples
 * @returns {Promise<string>} SRT text (may be empty if no speech)
 */
async function transcribeToSrt(pcm, { model = 'Xenova/whisper-tiny', language = 'auto' } = {}) {
  let asr;
  try {
    asr = await getAsr(model);
  } catch (e) {
    // Model download failed (e.g. network) — fall back to the small, usually-cached tiny model.
    if (model !== 'Xenova/whisper-tiny') {
      console.warn(`[transcribe] could not load ${model} (${e.message}); falling back to whisper-tiny`);
      asr = await getAsr('Xenova/whisper-tiny');
    } else {
      throw new Error('Could not download the speech model. Check your internet / HuggingFace access and retry. (' + e.message + ')');
    }
  }
  const opts = { chunk_length_s: 30, stride_length_s: 5, return_timestamps: true };
  if (language && language !== 'auto') opts.language = language;
  const result = await asr(pcm, opts);
  const chunks = (result.chunks && result.chunks.length)
    ? result.chunks
    : (result.text ? [{ timestamp: [0, null], text: result.text }] : []);
  return chunksToSrt(chunks);
}

module.exports = { transcribeToSrt };
