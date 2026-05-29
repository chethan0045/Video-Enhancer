# GPU image for the RunPod serverless endpoint (Phase 2 AI enhancement).
# CUDA 11.8 + torch 2.0.1 / torchvision 0.15.2 is the known-good combo for
# Real-ESRGAN + GFPGAN (basicsr breaks on torchvision >= 0.16).
FROM nvidia/cuda:11.8.0-cudnn8-runtime-ubuntu22.04

ENV DEBIAN_FRONTEND=noninteractive MODEL_DIR=/models PYTHONUNBUFFERED=1

RUN apt-get update && apt-get install -y --no-install-recommends \
    python3.10 python3-pip ffmpeg wget ca-certificates && \
    rm -rf /var/lib/apt/lists/* && \
    ln -sf /usr/bin/python3.10 /usr/bin/python

# Torch first, from the CUDA 11.8 index.
RUN pip install --no-cache-dir torch==2.0.1 torchvision==0.15.2 --index-url https://download.pytorch.org/whl/cu118

COPY requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -r /app/requirements.txt

# Pre-download model weights into the image so cold starts don't re-fetch them.
RUN mkdir -p ${MODEL_DIR} && \
    wget -O ${MODEL_DIR}/RealESRGAN_x4plus.pth https://github.com/xinntao/Real-ESRGAN/releases/download/v0.1.0/RealESRGAN_x4plus.pth && \
    wget -O ${MODEL_DIR}/GFPGANv1.4.pth https://github.com/TencentARC/GFPGAN/releases/download/v1.3.4/GFPGANv1.4.pth

# ── RIFE frame interpolation (optional) ──
# Vendor Practical-RIFE for the FPS-interpolation stage. The model weights live on
# Google Drive, so pass the file id at build time to bake them in:
#   docker build --build-arg RIFE_MODEL_GDRIVE_ID=<id> ...
# If omitted, the build still succeeds and RIFE is simply skipped at runtime until a
# train_log/ model is present (see runpod/README.md).
RUN pip install --no-cache-dir gdown && \
    git clone --depth 1 https://github.com/hzwer/Practical-RIFE.git /app/Practical-RIFE && \
    pip install --no-cache-dir -r /app/Practical-RIFE/requirements.txt || true
ARG RIFE_MODEL_GDRIVE_ID=
RUN if [ -n "$RIFE_MODEL_GDRIVE_ID" ]; then \
      cd /app/Practical-RIFE && gdown "$RIFE_MODEL_GDRIVE_ID" -O model.zip && \
      python -c "import zipfile;zipfile.ZipFile('model.zip').extractall('.')" && rm model.zip ; \
    else echo "No RIFE model id provided — RIFE will be skipped until train_log/ is added"; fi
ENV RIFE_DIR=/app/Practical-RIFE

COPY handler.py /app/handler.py
WORKDIR /app

CMD ["python", "-u", "handler.py"]
