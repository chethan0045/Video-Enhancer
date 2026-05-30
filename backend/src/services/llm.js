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

module.exports = { configured, complete, translateSrt, cleanupSrt, langName, LANGS };
