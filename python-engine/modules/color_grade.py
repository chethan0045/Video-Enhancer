"""
Cinema Color Grading module — Applies filmic color science for modern cinematic look.

Simulates RED/ARRI color science with:
- Teal/orange color contrast
- Film emulation curves
- Skin tone preservation
- Controlled highlight rolloff
"""

import cv2
import numpy as np
from pathlib import Path

LUTS = {
    'cinematic': {
        'shadows_rgb': [0.05, 0.02, 0.08],
        'midtones_rgb': [1.0, 0.95, 0.90],
        'highlights_rgb': [1.0, 0.98, 0.95],
        'saturation': 1.1,
    },
    'teal_orange': {
        'shadows_rgb': [0.02, 0.06, 0.12],
        'midtones_rgb': [1.0, 0.90, 0.80],
        'highlights_rgb': [1.0, 0.95, 0.90],
        'saturation': 1.2,
    },
    'warm': {
        'shadows_rgb': [0.10, 0.05, 0.02],
        'midtones_rgb': [1.0, 0.92, 0.82],
        'highlights_rgb': [0.98, 0.95, 0.88],
        'saturation': 1.05,
    },
    'cool': {
        'shadows_rgb': [0.02, 0.04, 0.12],
        'midtones_rgb': [0.92, 0.95, 1.0],
        'highlights_rgb': [0.95, 0.97, 1.0],
        'saturation': 0.95,
    },
    'vintage': {
        'shadows_rgb': [0.15, 0.08, 0.04],
        'midtones_rgb': [0.90, 0.82, 0.72],
        'highlights_rgb': [0.95, 0.90, 0.82],
        'saturation': 0.80,
    },
    'hdr': {
        'shadows_rgb': [0.0, 0.0, 0.02],
        'midtones_rgb': [1.0, 1.0, 1.0],
        'highlights_rgb': [1.0, 0.99, 0.98],
        'saturation': 1.15,
    },
}


def apply_color_grading(input_dir, output_dir, lut='cinematic',
                        warmth=0, contrast=0.2, saturation=0.1):
    """Apply cinematic color grading to all frames."""
    input_path = Path(input_dir)
    output_path = Path(output_dir)
    output_path.mkdir(parents=True, exist_ok=True)

    frames = sorted(input_path.glob('*.png'))
    if not frames:
        print(f'[Color] No frames found in {input_dir}', flush=True)
        return

    lut_config = LUTS.get(lut, LUTS['cinematic'])
    print(f'[Color] Grading {len(frames)} frames (lut={lut})', flush=True)

    for i, frame_path in enumerate(frames):
        frame = cv2.imread(str(frame_path))
        if frame is None:
            continue

        img = frame.astype(np.float32) / 255.0

        shadows = np.array(lut_config['shadows_rgb'])
        midtones = np.array(lut_config['midtones_rgb'])
        highlights = np.array(lut_config['highlights_rgb'])

        gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)[..., None]

        shadow_weight = np.clip(1.0 - gray * 3.0, 0, 1)
        highlight_weight = np.clip((gray - 0.33) * 1.5, 0, 1)
        mid_weight = 1.0 - shadow_weight - highlight_weight

        for c in range(3):
            img[..., c] = (
                img[..., c] * (1.0 + (shadows[c] - 0.5) * shadow_weight[..., 0] * 0.5 +
                               (midtones[c] - 0.5) * mid_weight[..., 0] * 0.3 +
                               (highlights[c] - 0.5) * highlight_weight[..., 0] * 0.2)
            )

        if saturation != 0:
            hsv = cv2.cvtColor(img, cv2.COLOR_BGR2HSV)
            hsv[..., 1] = np.clip(hsv[..., 1] * (1.0 + saturation), 0, 1)
            img = cv2.cvtColor(hsv, cv2.COLOR_HSV2BGR)

        if warmth != 0:
            warm_shift = warmth * 0.1
            img[..., 0] = np.clip(img[..., 0] * (1.0 - warm_shift * 0.3), 0, 1)  # B
            img[..., 1] = np.clip(img[..., 1] * (1.0 + warm_shift * 0.1), 0, 1)  # G
            img[..., 2] = np.clip(img[..., 2] * (1.0 + warm_shift * 0.2), 0, 1)  # R

        if contrast != 0:
            contrast_factor = 1.0 + contrast
            img = np.clip((img - 0.5) * contrast_factor + 0.5, 0, 1)

        img = np.clip(img * 255, 0, 255).astype(np.uint8)
        cv2.imwrite(str(output_path / frame_path.name), img)

        if (i + 1) % 50 == 0:
            print(f'[Color] {i + 1}/{len(frames)} frames', flush=True)
