"""
Temporal Enhancement module — Provides frame-to-frame consistency using optical flow.

This simulates BasicVSR++ style temporal fusion by:
1. Computing optical flow between consecutive frames
2. Applying temporal blending to reduce flicker
3. Stabilizing textures across frames

For production, replace with actual BasicVSR++ / RVRT model.
"""

import cv2
import numpy as np
from pathlib import Path
from collections import deque


def compute_flow(prev, curr):
    """Compute dense optical flow between two frames."""
    prev_gray = cv2.cvtColor(prev, cv2.COLOR_BGR2GRAY)
    curr_gray = cv2.cvtColor(curr, cv2.COLOR_BGR2GRAY)
    return cv2.calcOpticalFlowFarneback(
        prev_gray, curr_gray, None, 0.5, 3, 15, 3, 5, 1.2, 0
    )


def warp_frame(frame, flow):
    """Warp frame according to optical flow."""
    h, w = flow.shape[:2]
    map_x, map_y = np.meshgrid(np.arange(w), np.arange(h))
    map_x = map_x.astype(np.float32) + flow[..., 0]
    map_y = map_y.astype(np.float32) + flow[..., 1]
    return cv2.remap(frame, map_x, map_y, cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE)


def temporal_blend(frames_buffer):
    """Blend a buffer of frames for temporal smoothing."""
    weights = np.linspace(0.5, 1.0, len(frames_buffer))
    weights /= weights.sum()

    result = np.zeros_like(frames_buffer[0], dtype=np.float32)
    for frame, w in zip(frames_buffer, weights):
        result += frame.astype(np.float32) * w
    return np.clip(result, 0, 255).astype(np.uint8)


def temporal_enhance(input_dir, output_dir, window_size=3):
    """Apply temporal consistency enhancement across frames."""
    input_path = Path(input_dir)
    output_path = Path(output_dir)
    output_path.mkdir(parents=True, exist_ok=True)

    frames = sorted(input_path.glob('*.png'))
    if len(frames) < 2:
        print(f'[Temporal] Need at least 2 frames, found {len(frames)}', flush=True)
        return

    print(f'[Temporal] Processing {len(frames)} frames (window={window_size})', flush=True)

    frame_cache = {}
    for fp in frames:
        frame_cache[fp.name] = cv2.imread(str(fp))

    names = list(frame_cache.keys())

    for i, name in enumerate(names):
        if i == 0:
            result = frame_cache[name]
        else:
            prev_name = names[i - 1]
            prev_frame = frame_cache[prev_name]
            curr_frame = frame_cache[name]

            flow = compute_flow(prev_frame, curr_frame)
            warped_prev = warp_frame(prev_frame, flow)
            result = cv2.addWeighted(warped_prev, 0.3, curr_frame, 0.7, 0)
            frame_cache[name] = result

        cv2.imwrite(str(output_path / name), result)

        if (i + 1) % 50 == 0:
            print(f'[Temporal] {i + 1}/{len(frames)} frames', flush=True)
