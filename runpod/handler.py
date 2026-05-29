#!/usr/bin/env python3
"""
RunPod serverless handler — GPU video enhancement (Phase 2).

Runs the real AI models the FFmpeg tier can only approximate:
  - Real-ESRGAN  → super-resolution upscaling
  - GFPGAN       → face restoration
  (RIFE frame interpolation is scoped as a follow-up — see README.)

Job input (JSON):
{
  "video_url": "https://<your-app>/uploads/<file>.mp4",   # publicly fetchable
  "pipeline": {
     "upscale":     { "enabled": true, "scale": 4 },
     "faceRestore": { "enabled": true, "weight": 0.5 },
     "fps": 30
  },
  "output": { "mode": "base64" | "s3" }                    # how to return the result
}

Returns: { "output_base64": "...", "width", "height", "frames" }
     or  { "output_url": "https://..." }  when S3 is configured.

This file is deployed as the RunPod serverless image entrypoint. It is NOT used
by the Render API directly — Render dispatches to it over HTTP (see services/runpod.js).
"""

import base64
import os
import subprocess
import tempfile
import urllib.request
from pathlib import Path

import cv2
import runpod

MODEL_DIR = os.environ.get("MODEL_DIR", "/models")

# Lazily-initialised model singletons (loaded once per warm worker).
_state = {"upsampler": None, "face": None}


def _device():
    import torch
    return "cuda" if torch.cuda.is_available() else "cpu"


def get_upsampler():
    if _state["upsampler"] is None:
        from basicsr.archs.rrdbnet_arch import RRDBNet
        from realesrgan import RealESRGANer
        model = RRDBNet(num_in_ch=3, num_out_ch=3, num_feat=64, num_block=23, num_grow_ch=32, scale=4)
        _state["upsampler"] = RealESRGANer(
            scale=4,
            model_path=os.path.join(MODEL_DIR, "RealESRGAN_x4plus.pth"),
            model=model,
            tile=400, tile_pad=10, pre_pad=0,
            half=(_device() == "cuda"),
        )
    return _state["upsampler"]


def get_face_restorer():
    if _state["face"] is None:
        from gfpgan import GFPGANer
        _state["face"] = GFPGANer(
            model_path=os.path.join(MODEL_DIR, "GFPGANv1.4.pth"),
            upscale=4, arch="clean", channel_multiplier=2,
            bg_upsampler=get_upsampler(),
        )
    return _state["face"]


def _run(cmd):
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode != 0:
        raise RuntimeError(f"cmd failed: {' '.join(cmd[:3])}... :: {r.stderr[-500:]}")
    return r


def _download(url, dest):
    urllib.request.urlretrieve(url, dest)


def process_frames(frames_dir, out_dir, pipeline):
    up = pipeline.get("upscale", {}) or {}
    face = pipeline.get("faceRestore", {}) or {}
    do_upscale = up.get("enabled", True)
    do_face = face.get("enabled", True)
    outscale = float(up.get("scale", 4))

    upsampler = get_upsampler() if do_upscale else None
    restorer = get_face_restorer() if do_face else None

    frames = sorted(Path(frames_dir).glob("*.png"))
    total = len(frames)
    for i, fp in enumerate(frames):
        img = cv2.imread(str(fp), cv2.IMREAD_COLOR)
        if img is None:
            continue
        if restorer is not None:
            # GFPGAN restores faces and (via bg_upsampler) upscales the background too.
            _, _, img = restorer.enhance(img, has_aligned=False, only_center_face=False, paste_back=True, weight=float(face.get("weight", 0.5)))
        elif upsampler is not None:
            img, _ = upsampler.enhance(img, outscale=outscale)
        cv2.imwrite(str(Path(out_dir) / fp.name), img)
        if total and (i + 1) % 5 == 0:
            print(f"PROGRESS {int((i + 1) / total * 100)}", flush=True)
    return total


def probe_fps(path):
    try:
        r = subprocess.run(["ffprobe", "-v", "0", "-of", "csv=p=0", "-select_streams", "v:0",
                            "-show_entries", "stream=r_frame_rate", path], capture_output=True, text=True)
        num, den = (r.stdout.strip() or "30/1").split("/")
        return max(1.0, float(num) / float(den or 1))
    except Exception:
        return 30.0


def run_rife(in_video, out_video, src_fps, target_fps):
    """RIFE FPS interpolation via the vendored Practical-RIFE inference script.
    Defensive: returns False (caller keeps the non-interpolated video) if the
    model/repo isn't present or inference fails. This is the part most likely to
    need adjustment per RIFE version — see runpod/README.md."""
    rife_dir = os.environ.get("RIFE_DIR", "/app/Practical-RIFE")
    script = os.path.join(rife_dir, "inference_video.py")
    model = os.path.join(rife_dir, "train_log")
    if not (os.path.exists(script) and os.path.isdir(model)):
        print("[RIFE] model/repo not present — skipping interpolation", flush=True)
        return False
    multi = max(2, round(float(target_fps) / max(1.0, src_fps)))
    try:
        subprocess.run(["python", script, "--video", in_video, "--output", out_video,
                        "--multi", str(multi), "--fps", str(target_fps)],
                       cwd=rife_dir, check=True)
        if os.path.exists(out_video):
            return True
        # Some RIFE versions ignore --output and auto-name; grab the newest mp4 it produced.
        import glob
        cands = [p for p in glob.glob(os.path.join(rife_dir, "*.mp4")) if os.path.abspath(p) != os.path.abspath(in_video)]
        if cands:
            os.replace(max(cands, key=os.path.getmtime), out_video)
            return True
    except Exception as e:  # noqa: BLE001
        print(f"[RIFE] interpolation failed: {e}", flush=True)
    return False


def handler(job):
    inp = job.get("input", {}) or {}
    video_url = inp.get("video_url")
    if not video_url:
        return {"error": "video_url is required"}
    pipeline = inp.get("pipeline", {}) or {}

    with tempfile.TemporaryDirectory() as work:
        in_path = os.path.join(work, "in.mp4")
        frames = os.path.join(work, "frames"); os.makedirs(frames, exist_ok=True)
        out_frames = os.path.join(work, "out"); os.makedirs(out_frames, exist_ok=True)
        out_path = os.path.join(work, "out.mp4")

        _download(video_url, in_path)
        src_fps = probe_fps(in_path)
        _run(["ffmpeg", "-y", "-i", in_path, "-qscale:v", "2", os.path.join(frames, "%08d.png")])
        process_frames(frames, out_frames, pipeline)

        # Rebuild the enhanced video (silent) at the source frame rate.
        enhanced = os.path.join(work, "enhanced.mp4")
        _run([
            "ffmpeg", "-y", "-framerate", str(src_fps), "-i", os.path.join(out_frames, "%08d.png"),
            "-c:v", "libx264", "-preset", "medium", "-crf", "18", "-pix_fmt", "yuv420p",
            "-movflags", "+faststart", enhanced,
        ])

        # Optional RIFE frame interpolation to a higher fps.
        interp = pipeline.get("fpsInterpolation", {}) or {}
        video_only = enhanced
        out_fps = src_fps
        if interp.get("enabled"):
            target = float(interp.get("targetFps", 60))
            rife_out = os.path.join(work, "rife.mp4")
            if run_rife(enhanced, rife_out, src_fps, target):
                video_only = rife_out
                out_fps = target
                print(f"[RIFE] interpolated {src_fps:.1f} → {target:.1f} fps", flush=True)

        # Mux original audio back onto the (possibly interpolated) video.
        _run([
            "ffmpeg", "-y", "-i", video_only, "-i", in_path,
            "-map", "0:v:0", "-map", "1:a:0?", "-c:v", "copy", "-c:a", "aac",
            "-shortest", "-movflags", "+faststart", out_path,
        ])

        probe = cv2.VideoCapture(out_path)
        w = int(probe.get(cv2.CAP_PROP_FRAME_WIDTH)); h = int(probe.get(cv2.CAP_PROP_FRAME_HEIGHT))
        probe.release()

        # Return result. base64 is fine for short clips; configure S3 for large outputs.
        out_mode = (inp.get("output", {}) or {}).get("mode", "base64")
        if out_mode == "s3" and os.environ.get("S3_BUCKET"):
            url = _upload_s3(out_path)
            return {"output_url": url, "width": w, "height": h, "fps": round(out_fps, 2)}
        with open(out_path, "rb") as f:
            data = base64.b64encode(f.read()).decode("ascii")
        return {"output_base64": data, "width": w, "height": h, "fps": round(out_fps, 2)}


def _upload_s3(path):
    import boto3
    s3 = boto3.client(
        "s3",
        endpoint_url=os.environ.get("S3_ENDPOINT") or None,
        aws_access_key_id=os.environ.get("S3_ACCESS_KEY"),
        aws_secret_access_key=os.environ.get("S3_SECRET_KEY"),
    )
    bucket = os.environ["S3_BUCKET"]
    key = f"outputs/{os.path.basename(path)}"
    s3.upload_file(path, bucket, key, ExtraArgs={"ContentType": "video/mp4"})
    base = os.environ.get("S3_PUBLIC_BASE", "").rstrip("/")
    return f"{base}/{key}" if base else f"s3://{bucket}/{key}"


runpod.serverless.start({"handler": handler})
