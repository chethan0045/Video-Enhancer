"""
Utility functions for video processing.
"""

import cv2
import numpy as np
import json
import subprocess
from pathlib import Path


def get_video_info(video_path):
    """Get video metadata using FFprobe."""
    cmd = [
        'ffprobe', '-v', 'quiet', '-print_format', 'json',
        '-show_format', '-show_streams', video_path
    ]
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        raise RuntimeError(f'FFprobe failed: {result.stderr}')
    return json.loads(result.stdout)


def get_frame_count(frames_dir):
    """Count PNG frames in directory."""
    return len(list(Path(frames_dir).glob('*.png')))


def validate_frames(frames_dir, min_frames=1):
    """Check that frames directory has valid frames."""
    frames = sorted(Path(frames_dir).glob('*.png'))
    if len(frames) < min_frames:
        return False, f'Need at least {min_frames} frames, found {len(frames)}'
    test = cv2.imread(str(frames[0]))
    if test is None:
        return False, f'Cannot read frame: {frames[0]}'
    return True, f'{len(frames)} frames OK'


def create_comparison_grid(frame_before, frame_after):
    """Create side-by-side before/after comparison image."""
    h1, w1 = frame_before.shape[:2]
    h2, w2 = frame_after.shape[:2]
    h = min(h1, h2)
    w = min(w1, w2)

    fb = cv2.resize(frame_before, (w, h))
    fa = cv2.resize(frame_after, (w, h))

    grid = np.hstack([fb, fa])

    cv2.putText(grid, 'BEFORE', (10, 30),
                cv2.FONT_HERSHEY_SIMPLEX, 0.8, (255, 255, 255), 2)
    cv2.putText(grid, 'AFTER', (w + 10, 30),
                cv2.FONT_HERSHEY_SIMPLEX, 0.8, (0, 255, 0), 2)

    return grid
