/**
 * LLM service — Google Gemini (free tier). Used for subtitle translation & cleanup.
 * Set GEMINI_API_KEY (free key: https://aistudio.google.com/app/apikey).
 * Everything degrades gracefully: if the key is missing or a call fails, callers
 * keep the original text instead of erroring.
 */
const MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash-lite';

const LANGS = {
  en: 'English', kn: 'Kannada', hi: 'Hindi', ta: 'Tamil', te: 'Telugu', ml: 'Malayalam',
  es: 'Spanish', fr: 'French', de: 'German', ja: 'Japanese', ar: 'Arabic',
};
const langName = (code) => LANGS[code] || code;

function configured() { return !!process.env.GEMINI_API_KEY; }

async function complete(prompt, { temperature = 0.2 } = {}) {
  if (!configured()) throw new Error('GEMINI_API_KEY not set');
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${process.env.GEMINI_API_KEY}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { temperature } }),
  });
  if (!res.ok) throw new Error(`Gemini ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const j = await res.json();
  return (j.candidates?.[0]?.content?.parts?.[0]?.text || '').trim();
}

// Strip a ```...``` fence the model may wrap the SRT in.
function stripFences(t) {
  const m = t.match(/```(?:srt|vtt)?\s*([\s\S]*?)```/i);
  return (m ? m[1] : t).trim();
}

async function translateSrt(srt, targetLangCode) {
  if (!srt.trim()) return srt;
  const prompt =
    `Translate the dialogue in this SRT subtitle file to ${langName(targetLangCode)}. ` +
    `Keep the SRT structure EXACTLY (same cue numbers and timestamps); translate ONLY the spoken text lines. ` +
    `Do not add notes. Output only the SRT.\n\n${srt}`;
  const out = stripFences(await complete(prompt));
  return out || srt;
}

async function cleanupSrt(srt) {
  if (!srt.trim()) return srt;
  const prompt =
    `Fix punctuation, capitalization and obvious transcription mistakes in this SRT subtitle file. ` +
    `Keep cue numbers and timestamps unchanged. Output only the corrected SRT.\n\n${srt}`;
  const out = stripFences(await complete(prompt));
  return out || srt;
}

// Strip SRT cue numbers/timestamps down to plain dialogue.
function srtToText(srt) {
  return (srt || '')
    .replace(/^\d+\s*$/gm, '')
    .replace(/\d{2}:\d{2}:\d{2}[,.]\d{3}\s*-->\s*\d{2}:\d{2}:\d{2}[,.]\d{3}/g, '')
    .replace(/\n{2,}/g, '\n').replace(/[ \t]+/g, ' ').trim();
}

function parseJsonObject(t) {
  const m = t.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try { return JSON.parse(m[0]); } catch { return null; }
}

// Generate { title, description, tags[] } from a transcript (SRT or plain text).
async function generateMetadata(transcript) {
  const text = srtToText(transcript).slice(0, 8000);
  if (!text) return null;
  const prompt =
    `From this video transcript, write metadata as STRICT JSON with keys: ` +
    `"title" (catchy, under 70 chars), "description" (2–3 engaging sentences), ` +
    `"tags" (array of 5–8 lowercase keywords). Output ONLY the JSON object.\n\nTranscript:\n${text}`;
  const out = await complete(prompt, { temperature: 0.4 });
  const meta = parseJsonObject(out);
  if (!meta) return null;
  return {
    title: String(meta.title || '').trim(),
    description: String(meta.description || '').trim(),
    tags: Array.isArray(meta.tags) ? meta.tags.map(String).slice(0, 12) : [],
  };
}

module.exports = { configured, complete, translateSrt, cleanupSrt, generateMetadata, srtToText, langName, LANGS };
