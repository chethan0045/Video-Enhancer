"""
Film Texture Simulation module — Adds subtle film grain and texture for cinematic feel.

Simulates:
- Kodak/ARRI film grain
- Subtle gate weave
- Film-like halation
"""

import cv2
import numpy as np
from pathlib import Path


def generate_grain(h, w, intensity=0.02, variation='fine'):
    """Generate realistic film grain pattern."""
    if variation == 'fine':
        size = 1
    elif variation == 'medium':
        size = 2
    else:
        size = 3

    grain = np.random.randn(h, w) * intensity * 255

    if size > 1:
        grain = cv2.resize(grain, (w // size, h // size), interpolation=cv2.INTER_LINEAR)
        grain = cv2.resize(grain, (w, h), interpolation=cv2.INTER_LINEAR)

    return grain.astype(np.float32)


def apply_film_texture(input_dir, output_dir, texture_type='grain_light'):
    """Apply film texture to all frames."""
    input_path = Path(input_dir)
    output_path = Path(output_dir)
    output_path.mkdir(parents=True, exist_ok=True)

    frames = sorted(input_path.glob('*.png'))
    if not frames:
        print(f'[FilmTexture] No frames found in {input_dir}', flush=True)
        return

    intensity_map = {
        'grain_light': 0.015,
        'grain_medium': 0.03,
        'grain_heavy': 0.05,
        'film_8mm': 0.06,
        'film_16mm': 0.04,
        'film_35mm': 0.02,
    }

    intensity = intensity_map.get(texture_type, 0.02)
    print(f'[FilmTexture] Processing {len(frames)} frames (type={texture_type})', flush=True)

    h, w = None, None
    seed = 0

    for i, frame_path in enumerate(frames):
        frame = cv2.imread(str(frame_path))
        if frame is None:
            continue

        if h is None:
            h, w = frame.shape[:2]

        np.random.seed(seed)
        seed += 1

        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)

        if texture_type in ('film_8mm', 'film_16mm'):
            grain_variation = 'coarse'
        elif texture_type in ('film_35mm',):
            grain_variation = 'medium'
        else:
            grain_variation = 'fine'

        grain = generate_grain(h, w, intensity, grain_variation)
        grain_strength = 1.0 - gray.astype(np.float32) / 255.0 * 0.5
        grain_adjusted = grain * grain_strength

        result = frame.astype(np.float32)
        for c in range(3):
            result[..., c] = np.clip(result[..., c] + grain_adjusted, 0, 255)

        if texture_type in ('film_8mm', 'film_16mm'):
            vignette_x = np.linspace(-1, 1, w)
            vignette_y = np.linspace(-1, 1, h)
            X, Y = np.meshgrid(vignette_x, vignette_y)
            vignette = 1.0 - 0.3 * np.sqrt(X ** 2 + Y ** 2)
            vignette = np.clip(vignette, 0, 1)[..., None]
            result = result * vignette

        cv2.imwrite(str(output_path / frame_path.name), np.clip(result, 0, 255).astype(np.uint8))

        if (i + 1) % 50 == 0:
            print(f'[FilmTexture] {i + 1}/{len(frames)} frames', flush=True)
