"""
Frame Interpolation module — Increases frame rate using RIFE-style motion interpolation.

Simulates RIFE (Real-Time Intermediate Flow Estimation) by:
1. Computing optical flow between frames
2. Generating intermediate frames via flow-based warping
3. Blending for smooth motion

For production, replace with actual RIFE model.
"""

import cv2
import numpy as np
from pathlib import Path
import shutil


def interpolate_between(frame1, frame2, t=0.5):
    """Generate intermediate frame at time t between frame1 and frame2."""
    flow = cv2.calcOpticalFlowFarneback(
        cv2.cvtColor(frame1, cv2.COLOR_BGR2GRAY),
        cv2.cvtColor(frame2, cv2.COLOR_BGR2GRAY),
        None, 0.5, 3, 15, 3, 5, 1.2, 0
    )

    h, w = frame1.shape[:2]
    map_x, map_y = np.meshgrid(np.arange(w), np.arange(h))
    map_x = map_x.astype(np.float32) + flow[..., 0] * t
    map_y = map_y.astype(np.float32) + flow[..., 1] * t

    warped1 = cv2.remap(frame1, map_x, map_y, cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE)

    flow_bwd = cv2.calcOpticalFlowFarneback(
        cv2.cvtColor(frame2, cv2.COLOR_BGR2GRAY),
        cv2.cvtColor(frame1, cv2.COLOR_BGR2GRAY),
        None, 0.5, 3, 15, 3, 5, 1.2, 0
    )

    map_x_bwd = map_x + flow_bwd[..., 0] * (1 - t)
    map_y_bwd = map_y + flow_bwd[..., 1] * (1 - t)

    warped2 = cv2.remap(frame2, map_x_bwd, map_y_bwd, cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE)

    result = cv2.addWeighted(warped1, 1.0 - t, warped2, t, 0)
    return result


def interpolate_frames(input_dir, output_dir, source_fps=24, target_fps=60):
    """Interpolate frames to target FPS."""
    input_path = Path(input_dir)
    output_path = Path(output_dir)
    output_path.mkdir(parents=True, exist_ok=True)

    frames = sorted(input_path.glob('*.png'))
    if len(frames) < 2:
        print(f'[Interpolation] Need >= 2 frames, found {len(frames)}', flush=True)
        return

    ratio = target_fps / source_fps
    total_output = int(len(frames) * ratio)

    print(f'[Interpolation] {len(frames)} → {total_output} frames ({source_fps}→{target_fps}FPS)', flush=True)

    frame_cache = {}
    for fp in frames:
        frame_cache[fp.name] = cv2.imread(str(fp))

    names = sorted(frame_cache.keys())
    output_idx = 0

    for i in range(len(names) - 1):
        frame1 = frame_cache[names[i]]
        frame2 = frame_cache[names[i + 1]]

        out_name = f'{output_idx + 1:08d}.png'
        cv2.imwrite(str(output_path / out_name), frame1)
        output_idx += 1

        num_interp = int(ratio) - 1
        for j in range(num_interp):
            t = (j + 1) / (num_interp + 1)
            interp = interpolate_between(frame1, frame2, t)
            out_name = f'{output_idx + 1:08d}.png'
            cv2.imwrite(str(output_path / out_name), interp)
            output_idx += 1

    out_name = f'{output_idx + 1:08d}.png'
    cv2.imwrite(str(output_path / out_name), frame_cache[names[-1]])

    print(f'[Interpolation] Generated {output_idx + 1} frames', flush=True)
    return str(output_path)
