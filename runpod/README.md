# RunPod GPU Worker — Phase 2 AI Enhancement

Real GPU AI (Real-ESRGAN upscaling + GFPGAN face restoration) for CineRemaster.
Render stays the API/orchestrator and dispatches AI jobs here over HTTP; the
FFmpeg tier on Render remains the fast/free tier and the automatic fallback.

> **Status: built, not yet verified.** This needs an NVIDIA GPU to run, which the
> dev machine and Render don't have. Build the image, deploy it as a RunPod
> serverless endpoint, set the env vars on Render, then run the test below.

## 1. Build & push the image
```bash
cd runpod
docker build -t <your-dockerhub>/cineremaster-gpu:latest .
docker push <your-dockerhub>/cineremaster-gpu:latest
```
(The image bakes in the model weights, so first cold start is slower but then cached.)

## 2. Create the RunPod serverless endpoint
- RunPod → Serverless → New Endpoint → use the pushed image.
- GPU: a 16GB card (e.g. RTX A4000/4090) is plenty for 1080p→4K.
- Container disk ≥ 15GB (weights + frames). Set **Max workers** to your concurrency.
- Note the **Endpoint ID** and create a RunPod **API key**.

## 3. Point Render at it
Set on the Render service (and locally in `backend/.env` to test against RunPod):
```
RUNPOD_API_KEY=...
RUNPOD_ENDPOINT_ID=...
PUBLIC_BASE_URL=https://video-enhancer-m17y.onrender.com   # so the GPU worker can fetch /uploads
```
With these set, an enhance job whose `pipeline.engine === 'ai'` is dispatched to RunPod.
Without them, the backend automatically falls back to the FFmpeg tier.

## 4. Test the endpoint directly
```bash
curl -s -X POST https://api.runpod.ai/v2/<ENDPOINT_ID>/runsync \
  -H "Authorization: Bearer <API_KEY>" -H "Content-Type: application/json" \
  -d '{"input":{"video_url":"https://<app>/uploads/<file>.mp4","pipeline":{"upscale":{"enabled":true,"scale":4},"faceRestore":{"enabled":true,"weight":0.5},"fps":30}}}'
```
Expect JSON with `output_base64` (short clips) or `output_url` (if S3 configured).

## Output transfer
- Default: result returned as **base64** — fine for short clips, but RunPod caps
  output payload size, so long/large videos need storage.
- For large outputs set `S3_BUCKET`/`S3_ENDPOINT`/`S3_ACCESS_KEY`/`S3_SECRET_KEY`/`S3_PUBLIC_BASE`
  on the endpoint and pass `"output":{"mode":"s3"}`; the handler uploads and returns a URL.

## Not yet included (next Phase 2 increments)
- **RIFE** frame interpolation (24→60fps) — add the model + a `fps` stage in `process_frames`.
- **Background noise removal** — can run on the CPU/FFmpeg tier (`afftdn`), no GPU needed.
