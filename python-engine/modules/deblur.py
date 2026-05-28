"""
AI Deblur module — Reduces motion blur and optical blur using Wiener deconvolution
and sharpness enhancement. Designed for old movie footage with inherent softness.
"""

import cv2
import numpy as np
from pathlib import Path
from scipy.signal import wiener


def estimate_blur_kernel(shape=(15, 15), strength=0.5):
    """Create a Gaussian blur kernel for deconvolution."""
    ksize = max(3, int(strength * 21) | 1)
    kernel = cv2.getGaussianKernel(ksize, strength * 5 + 1)
    kernel = kernel @ kernel.T
    kernel /= kernel.sum()
    return kernel


def deblur_frame(frame, strength=0.5):
    """Apply deblurring to a single frame using Wiener deconvolution + sharpening."""
    lab = cv2.cvtColor(frame, cv2.COLOR_BGR2LAB)
    l, a, b = cv2.split(lab)

    kernel = estimate_blur_kernel(strength=strength)
    if strength > 0.3:
        deconvolved = wiener(l.astype(np.float64) / 255.0, mysize=int(strength * 15 + 3))
        l_deblurred = np.clip(deconvolved * 255, 0, 255).astype(np.uint8)
    else:
        l_deblurred = l

    sharpen_strength = strength * 2.0
    kernel_sharpen = np.array([
        [-sharpen_strength, -sharpen_strength, -sharpen_strength],
        [-sharpen_strength, 1 + 8 * sharpen_strength, -sharpen_strength],
        [-sharpen_strength, -sharpen_strength, -sharpen_strength],
    ])
    l_sharp = cv2.filter2D(l_deblurred, -1, kernel_sharpen)

    blended = cv2.addWeighted(l_deblurred, 0.4, l_sharp, 0.6, 0)
    deblurred = cv2.merge([blended, a, b])
    deblurred = cv2.cvtColor(deblurred, cv2.COLOR_LAB2BGR)

    return deblurred


def deblur_frames(input_dir, output_dir, strength=0.5):
    """Deblur all frames in a directory."""
    input_path = Path(input_dir)
    output_path = Path(output_dir)
    output_path.mkdir(parents=True, exist_ok=True)

    frames = sorted(input_path.glob('*.png'))
    if not frames:
        print(f'[Deblur] No frames found in {input_dir}', flush=True)
        return

    print(f'[Deblur] Processing {len(frames)} frames (strength={strength})', flush=True)

    for i, frame_path in enumerate(frames):
        frame = cv2.imread(str(frame_path))
        if frame is None:
            continue

        deblurred = deblur_frame(frame, strength)
        cv2.imwrite(str(output_path / frame_path.name), deblurred)

        if (i + 1) % 50 == 0:
            print(f'[Deblur] {i + 1}/{len(frames)} frames', flush=True)
