"""
HDR Reconstruction module — Expands dynamic range to simulate modern cinema camera look.

Applies:
1. Shadow recovery via local tone mapping
2. Highlight compression with filmic rolloff
3. Contrast enhancement with S-curve
4. HDR bloom effect
"""

import cv2
import numpy as np
from pathlib import Path


def apply_filmic_curve(luminance, strength=0.7):
    """Apply filmic S-curve for dynamic range expansion."""
    x = luminance.astype(np.float32) / 255.0

    shadows = 1.0 - np.power(1.0 - x, 1.5)
    highlights = np.power(x, 0.85)

    shadow_strength = strength * 0.4
    highlight_strength = strength * 0.6

    result = np.where(
        x < 0.5,
        x * (1.0 - shadow_strength) + shadows * shadow_strength,
        x * (1.0 - highlight_strength) + highlights * highlight_strength
    )

    contrast = strength * 0.3 + 0.7
    mid = 0.5
    result = np.power(result, np.log(0.5) / np.log(mid * (1.0 - contrast) + contrast * mid))

    return np.clip(result * 255, 0, 255).astype(np.uint8)


def apply_highlight_bloom(frame, strength=0.5):
    """Apply subtle bloom/glow to bright areas."""
    gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
    bright_mask = cv2.threshold(gray, 200, 255, cv2.THRESH_BINARY)[0]
    bright_mask = bright_mask.astype(np.float32) / 255.0

    blurred = cv2.GaussianBlur(frame, (15, 15), 5)
    bloom = cv2.addWeighted(frame, 1.0, blurred, strength * bright_mask[..., None], 0)
    return np.clip(bloom, 0, 255).astype(np.uint8)


def apply_hdr(input_dir, output_dir, strength=0.7):
    """Apply HDR reconstruction to all frames."""
    input_path = Path(input_dir)
    output_path = Path(output_dir)
    output_path.mkdir(parents=True, exist_ok=True)

    frames = sorted(input_path.glob('*.png'))
    if not frames:
        print(f'[HDR] No frames found in {input_dir}', flush=True)
        return

    print(f'[HDR] Processing {len(frames)} frames (strength={strength})', flush=True)

    for i, frame_path in enumerate(frames):
        frame = cv2.imread(str(frame_path))
        if frame is None:
            continue

        lab = cv2.cvtColor(frame, cv2.COLOR_BGR2LAB)
        l, a, b = cv2.split(lab)

        l_hdr = apply_filmic_curve(l, strength)

        contrast = strength * 0.5 + 0.5
        l_hdr = np.clip(
            (l_hdr.astype(np.float32) - 128) * contrast + 128, 0, 255
        ).astype(np.uint8)

        merged = cv2.merge([l_hdr, a, b])
        hdr_frame = cv2.cvtColor(merged, cv2.COLOR_LAB2BGR)

        if strength > 0.5:
            hdr_frame = apply_highlight_bloom(hdr_frame, strength * 0.3)

        cv2.imwrite(str(output_path / frame_path.name), hdr_frame)

        if (i + 1) % 50 == 0:
            print(f'[HDR] {i + 1}/{len(frames)} frames', flush=True)
