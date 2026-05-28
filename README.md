# CineRemaster AI 🎬

**AI Cinematic Video Remaster Engine** — Transform old footage into modern RED-camera quality with temporal AI enhancement.

## Architecture

```
Angular Frontend (UI)
    ↓
Node.js Backend (API + Job Queue)
    ↓
Python AI Engine (GPU Processing)
    ↓
MongoDB (Jobs + Users)
```

## Pipeline

```
Input → Denoise → Deblur → Temporal → Upscale → Face → HDR → Color Grade → 4K Export
```

## Quick Start

### Prerequisites
- Node.js 20+
- Python 3.10+
- MongoDB 7+
- Redis 7+
- FFmpeg
- CUDA-capable GPU (recommended)

### Install

```bash
# Install all dependencies
npm install
npm run install:all

# Python deps
cd python-engine
pip install -r requirements.txt
cd ..

# Copy env
cp backend/.env.example backend/.env
```

### Run (Development)

```bash
# Terminal 1: MongoDB + Redis (Docker)
docker-compose up -d mongodb redis

# Terminal 2: Backend
cd backend && npm run dev

# Terminal 3: Frontend
cd frontend && npm start

# Seed AI models
cd backend && node scripts/seed.js
```

### Docker (Production)

```bash
docker-compose up -d --build
```

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Angular 18, Material, TailwindCSS |
| Backend | Node.js, Express, Socket.IO, BullMQ |
| Database | MongoDB, Redis |
| AI Engine | Python, PyTorch, CUDA, OpenCV |
| Media | FFmpeg, libx265 (10-bit HEVC) |

## AI Models

| Task | Model | Status |
|------|-------|--------|
| Temporal | BasicVSR++ / RVRT | 🔧 Fallback active |
| Upscale | Real-ESRGAN / SwinIR | 🔧 Fallback active |
| Face | CodeFormer / GFPGAN | 🔧 Fallback active |
| Deblur | Restormer | 🔧 Fallback active |
| Interpolation | RIFE | 🔧 Fallback active |
| Depth | MiDaS | 🔧 Fallback active |
