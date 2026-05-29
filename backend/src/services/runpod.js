/**
 * RunPod serverless client — dispatches AI enhancement jobs to a GPU endpoint.
 * Used only when RUNPOD_API_KEY + RUNPOD_ENDPOINT_ID are set; the caller falls
 * back to the FFmpeg tier otherwise.
 */
// Override the base for testing against a mock; defaults to the real RunPod API.
const API = process.env.RUNPOD_API_BASE || 'https://api.runpod.ai/v2';

function configured() {
  return !!(process.env.RUNPOD_API_KEY && process.env.RUNPOD_ENDPOINT_ID);
}

function authHeaders() {
  return { Authorization: `Bearer ${process.env.RUNPOD_API_KEY}`, 'Content-Type': 'application/json' };
}

async function submit(input) {
  const ep = process.env.RUNPOD_ENDPOINT_ID;
  const res = await fetch(`${API}/${ep}/run`, { method: 'POST', headers: authHeaders(), body: JSON.stringify({ input }) });
  if (!res.ok) throw new Error(`RunPod submit ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return res.json(); // { id, status }
}

async function status(id) {
  const ep = process.env.RUNPOD_ENDPOINT_ID;
  const res = await fetch(`${API}/${ep}/status/${id}`, { headers: authHeaders() });
  if (!res.ok) throw new Error(`RunPod status ${res.status}`);
  return res.json(); // { status, output, error }
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

/**
 * Submit and poll until the job reaches a terminal state. onStatus(statusString)
 * is called on each poll so the caller can map RunPod states to job progress.
 * Times out after ~20 minutes.
 */
async function runToCompletion(input, onStatus) {
  const { id } = await submit(input);
  let delay = 2000;
  const deadline = Date.now() + 20 * 60 * 1000;
  for (;;) {
    if (Date.now() > deadline) throw new Error('RunPod job timed out');
    await sleep(delay);
    const s = await status(id);
    if (onStatus) onStatus(s.status);
    if (s.status === 'COMPLETED') return s.output;
    if (s.status === 'FAILED' || s.status === 'CANCELLED') {
      throw new Error(`RunPod job ${s.status}: ${JSON.stringify(s.output || s.error || '')}`.slice(0, 400));
    }
    delay = Math.min(delay + 1000, 8000);
  }
}

module.exports = { configured, runToCompletion };
