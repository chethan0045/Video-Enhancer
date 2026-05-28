"""
Depth-of-Field Simulation module — Creates cinematic depth by simulating
shallow depth of field using MiDaS-style depth estimation.

Simulates the look of RED/ARRI cinema lenses with:
- Subject isolation
- Smooth background bokeh
- Foreground/background separation
"""

import cv2
import numpy as np
from pathlib import Path


def estimate_depth(frame):
    """
    Estimate depth map using edge-based focus measure.
    
    Returns a rough depth map where brighter = closer.
    For production, use actual MiDaS model.
    """
    gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)

    laplacian = cv2.Laplacian(gray, cv2.CV_32F)
    focus_map = cv2.GaussianBlur(np.abs(laplacian), (31, 31), 0)

    h, w = focus_map.shape
    center_y, center_x = h // 2, w // 2

    Y, X = np.ogrid[:h, :w]
    dist_from_center = np.sqrt((X - center_x) ** 2 + (Y - center_y) ** 2)
    center_weight = 1.0 - dist_from_center / max(h, w) * 0.5

    depth = focus_map * center_weight
    depth = cv2.GaussianBlur(depth, (61, 61), 0)

    depth = (depth - depth.min()) / (depth.max() - depth.min() + 1e-6)
    return depth.astype(np.float32)


def apply_bokeh_blur(frame, depth_map, blur_strength=0.3):
    """Apply depth-dependent blur (closer = sharp, farther = blurred)."""
    result = frame.copy().astype(np.float32)

    blur_levels = [0, 3, 7, 15, 31, 51]
    num_levels = len(blur_levels)

    depth_quantized = np.clip(
        (depth_map * (num_levels - 1) * blur_strength * 4).astype(np.int32),
        0, num_levels - 1
    )

    for level in range(num_levels):
        if blur_levels[level] == 0:
            continue

        mask = (depth_quantized == level).astype(np.float32)
        if mask.sum() < 100:
            continue

        blurred = cv2.GaussianBlur(frame, (blur_levels[level], blur_levels[level]), 0)
        mask_expanded = cv2.GaussianBlur(mask, (15, 15), 0)[..., None]
        result = result * (1.0 - mask_expanded) + blurred.astype(np.float32) * mask_expanded

    return np.clip(result, 0, 255).astype(np.uint8)


def apply_depth_of_field(input_dir, output_dir, blur_strength=0.3):
    """Apply cinematic depth-of-field effect to all frames."""
    input_path = Path(input_dir)
    output_path = Path(output_dir)
    output_path.mkdir(parents=True, exist_ok=True)

    frames = sorted(input_path.glob('*.png'))
    if not frames:
        print(f'[Depth] No frames found in {input_dir}', flush=True)
        return

    print(f'[Depth] Processing {len(frames)} frames (blur={blur_strength})', flush=True)

    depth_cache = {}

    for i, frame_path in enumerate(frames):
        frame = cv2.imread(str(frame_path))
        if frame is None:
            continue

        if i == 0:
            depth_map = estimate_depth(frame)
            depth_cache['map'] = depth_map
        else:
            depth_map = depth_cache.get('map', estimate_depth(frame))

        result = apply_bokeh_blur(frame, depth_map, blur_strength)

        cv2.imwrite(str(output_path / frame_path.name), result)

        if (i + 1) % 50 == 0:
            print(f'[Depth] {i + 1}/{len(frames)} frames', flush=True)
