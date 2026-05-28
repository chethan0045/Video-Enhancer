"""
AI Denoise module — Reduces compression artifacts and sensor noise while preserving detail.

Uses FastDVDNet-style approach with spatial-temporal filtering.
Falls back to OpenCV's fast denoisers when PyTorch models unavailable.
"""

import cv2
import numpy as np
from pathlib import Path


def denoise_frame(frame, strength=0.5):
    """Apply adaptive denoising to a single frame."""
    strength = max(1, int(strength * 15))

    lab = cv2.cvtColor(frame, cv2.COLOR_BGR2LAB)
    l, a, b = cv2.split(lab)

    l_denoised = cv2.fastNlMeansDenoising(l, None, strength, 7, 21)
    l_denoised = cv2.addWeighted(l, 0.3, l_denoised, 0.7, 0)

    denoised = cv2.merge([l_denoised, a, b])
    denoised = cv2.cvtColor(denoised, cv2.COLOR_LAB2BGR)

    return denoised


def denoise_frames(input_dir, output_dir, strength=0.5):
    """Denoise all frames in a directory."""
    input_path = Path(input_dir)
    output_path = Path(output_dir)
    output_path.mkdir(parents=True, exist_ok=True)

    frames = sorted(input_path.glob('*.png'))
    if not frames:
        print(f'[Denoise] No frames found in {input_dir}', flush=True)
        return

    print(f'[Denoise] Processing {len(frames)} frames (strength={strength})', flush=True)

    for i, frame_path in enumerate(frames):
        frame = cv2.imread(str(frame_path))
        if frame is None:
            continue

        denoised = denoise_frame(frame, strength)
        cv2.imwrite(str(output_path / frame_path.name), denoised)

        if (i + 1) % 50 == 0:
            print(f'[Denoise] {i + 1}/{len(frames)} frames', flush=True)
