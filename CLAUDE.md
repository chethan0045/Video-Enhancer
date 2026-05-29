# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

CineRemaster AI — a video enhancement platform that upscales/restores footage toward "4K cinematic" quality. Three tiers: an **Angular 18 frontend**, a **Node.js/Express backend** (API + job orchestration + WebSocket progress), and a **Python AI engine** (frame-by-frame enhancement). MongoDB/Redis are optional — the backend degrades to file-based and in-memory equivalents (see below).

## Commands

All from the repo root unless noted.

```bash
npm run install:all        # install root + backend + frontend deps (postinstall also installs frontend)
npm run dev                # run backend + frontend concurrently (dev)
npm run dev:backend        # backend only — nodemon src/server.js (port 5000)
npm run dev:frontend       # frontend only — ng serve via proxy (port 4200)
npm run build              # build Angular frontend for production
npm run docker:up          # docker-compose up -d (mongo, redis, backend, frontend)

cd backend && npm start    # production backend (node src/server.js)
cd backend && npm run worker   # standalone BullMQ worker (only useful with Redis)
cd backend && node scripts/seed.js   # seed AI models — only needed for MongoDB; NeDB auto-seeds

cd frontend && npm test    # Angular/Karma unit tests (ng test)
cd frontend && npm run build   # ng build --configuration production → frontend/dist/browser
```

There is no backend test suite and no linter configured. Python engine has no runner script of its own — it is always invoked by the backend worker (`python run_pipeline.py --input ... --output ... --job-id ... --config '{json}'`).

Config lives in `backend/.env` (copy from `backend/.env.example`). All external services are optional; leaving `MONGODB_URI` / `REDIS_HOST` unset is the intended zero-setup path.

## Architecture — the big picture

Request flow: Angular → `/api/*` (proxied to `:5000` in dev) → Express controllers → job queue → processing → progress pushed back over Socket.IO.

### Graceful degradation is the central design pattern

Almost every external dependency has a built-in fallback, chosen at runtime. When editing, assume the fallback path is the one that actually runs locally:

- **Database** (`backend/src/db.js`): Mongoose/MongoDB if `MONGODB_URI` connects within 3s, else a **custom NeDB file-based adapter** that reimplements a subset of Mongo query operators (`$or`, `$and`, `$ne`, `$gt`, `$in`, `$regex`, …), sort/skip/limit, and update operators. Data files land in `backend/data/*.db`. `getCollection(name, schema)` returns either a Mongoose model or a `NeDBCollection`.
- **Models** (`backend/src/models/index.js`, `models/VideoJob.js`): `User`, `VideoJob`, `AIModel` are plain objects wrapping `db.getCollection`, *not* raw Mongoose models — they work identically against MongoDB or NeDB. `AIModel` self-seeds its catalog on first access. `VideoJob.create` deep-merges user pipeline settings over `buildDefaultPipeline()`.
- **Queue** (`backend/src/queue/index.js`): jobs are processed **inline** by `queue/processor.js` via `setImmediate` (FFmpeg runs in spawned child processes, so the event loop stays responsive). No separate worker process is required. BullMQ/Redis is only used when `USE_QUEUE_WORKER=true` AND a `queue/worker.js` process is running; otherwise it's irrelevant.

### Processing (one path: FFmpeg)

All jobs run through `queue/processor.js`, branching on `VideoJob.mode`:

- **`enhance`** → `processVideo()`: an **FFmpeg filter-chain** pass (denoise via `hqdn3d`, sharpen via `cas`, color LUTs via `eq`/`colorbalance`, deband, scaling via `zscale`/`scale`). If FFmpeg is missing it falls back to `simulatePipeline()` (fakes progress, copies input). 
- **`edit`** → `processEdit()`: trim/crop only, no enhancement filters (stream-copy when only trimming, re-encode only when cropping).

`queue/worker.js` exists for the optional BullMQ path and calls the same two functions — behaviour is identical whether or not a dedicated worker is used.

**Encoder selection is hardware-adaptive** (`pickHwEncoder`/`buildEncoderArgs`): probes NVENC/QSV/AMF at startup (via `-f null -`, not `-y nul` which fails on Windows), uses H.264 hardware for ≤4K and HEVC hardware for 8K, and falls back to `libx264` (CPU, segmented in parallel for long videos) where there's no capable GPU — e.g. the live server. The same build runs everywhere, as fast as the host allows.

### Python AI engine (`python-engine/`) — currently unused

`run_pipeline.py` orchestrates a 12-stage frame-by-frame pipeline, but it is **not wired into the running app** (enhancement uses the FFmpeg path above). Its modules are **OpenCV placeholders, not real AI** — `upscale.py` is explicitly "Simulated Real-ESRGAN"; the named models (Real-ESRGAN, CodeFormer, etc.) are aspirational (README "Fallback active"). It also requires `opencv-python`/`torch` which are not installed. Treat it as dead/reference code unless real model weights + deps are added.

### Progress / realtime (`backend/src/websocket/index.js`)

Socket.IO with JWT auth over the socket. Clients `authenticate` (joins room `user:<id>`) and `subscribe:job` (joins `job:<id>`). Both processors call `emitJobProgress(jobId, {...})`, which emits `job:progress` to the job room and `job:update` to the user room. The job's `pipelineStages[]` array tracks per-stage status and is updated alongside the overall `progress` percentage.

### Auth

JWT bearer tokens. `backend/src/middleware/auth.js` populates `req.user`; controllers enforce ownership by comparing `job.userId !== req.user.id`. Passwords are bcrypt-hashed in the `User` model. Default `JWT_SECRET` is `dev-secret` when unset — set it for any real deployment.

### Backend HTTP surface (`backend/src/server.js`)

Routes mounted under `/api/auth`, `/api/jobs`, `/api/models`, `/api/upload`. Uploads/outputs are served as static files from `/uploads` and `/outputs`. In `NODE_ENV=production` the backend also serves the built Angular app from `../../frontend/dist/browser` (SPA fallback for non-API routes) — this is how the single-service Render deployment works. Job uploads go through `multer` disk storage in `backend/src/uploads/`, keyed by UUID filename.

### Frontend (`frontend/src/app/`)

Standalone Angular 18 components, lazy-loaded via `app.routes.ts` (dashboard, upload, processing/:id, preview/:id, editor/:id, settings), all behind `authGuard`. `core/` holds singletons: `auth.service`, `auth.guard`, `auth.interceptor` (attaches JWT), `job.service`, `upload.service`, `websocket.service`. Dev requests are proxied per `proxy.conf.json` (`/api`, `/socket.io`, `/uploads`, `/outputs` → `:5000`).

## Pipeline config shape

A job's `pipeline` object is the contract shared across all three tiers (defined in `buildDefaultPipeline()` in `models/VideoJob.js` and consumed by both `processor.js` and `run_pipeline.py`). Keys: `denoise`, `deblur`, `upscale` (`target`: `1080p`/`2k`/`4k`/`8k`), `temporal`, `faceRestore`, `depthSimulation`, `fpsInterpolation`, `hdr`, `colorGrading` (with `lut`), `filmTexture`, and `editor` (`trim`, `crop`). When adding a pipeline option, update all three: the schema/defaults, the FFmpeg processor, and the Python stage.
