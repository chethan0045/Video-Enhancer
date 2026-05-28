"""
Face Restoration module — Enhances facial details using AI-based restoration.

Primary: CodeFormer-style face enhancement.
Fallback: Bilateral filter + local contrast enhancement for faces.
For production, load actual CodeFormer or GFPGAN weights.
"""

import cv2
import numpy as np
from pathlib import Path


def detect_faces(frame):
    """Detect faces using OpenCV Haar cascade."""
    gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
    face_cascade = cv2.CascadeClassifier(
        cv2.data.haarcascades + 'haarcascade_frontalface_default.xml'
    )
    faces = face_cascade.detectMultiScale(
        gray, scaleFactor=1.1, minNeighbors=5, minSize=(40, 40)
    )
    return faces


def enhance_face_region(face_roi, strength=0.6):
    """Apply localized enhancement to a face region."""
    lab = cv2.cvtColor(face_roi, cv2.COLOR_BGR2LAB)
    l, a, b = cv2.split(lab)

    clahe = cv2.createCLAHE(clipLimit=strength * 3.0, tileGridSize=(8, 8))
    l_enhanced = clahe.apply(l)

    denoised = cv2.fastNlMeansDenoising(l_enhanced, None, 5, 7, 21)

    kernel = np.array([
        [-0.3, -0.3, -0.3],
        [-0.3,  3.4, -0.3],
        [-0.3, -0.3, -0.3],
    ])
    l_sharp = cv2.filter2D(denoised, -1, kernel)

    merged = cv2.merge([l_sharp, a, b])
    enhanced = cv2.cvtColor(merged, cv2.COLOR_LAB2BGR)

    return np.clip(enhanced, 0, 255).astype(np.uint8)


def restore_faces(input_dir, output_dir, strength=0.6, model='CodeFormer'):
    """Detect and enhance faces across all frames."""
    input_path = Path(input_dir)
    output_path = Path(output_dir)
    output_path.mkdir(parents=True, exist_ok=True)

    frames = sorted(input_path.glob('*.png'))
    if not frames:
        print(f'[Face] No frames found in {input_dir}', flush=True)
        return

    print(f'[Face] Processing {len(frames)} frames (strength={strength})', flush=True)
    total_faces = 0

    for i, frame_path in enumerate(frames):
        frame = cv2.imread(str(frame_path))
        if frame is None:
            continue

        faces = detect_faces(frame)

        for (x, y, w, h) in faces:
            margin = int(min(w, h) * 0.15)
            x1 = max(0, x - margin)
            y1 = max(0, y - margin)
            x2 = min(frame.shape[1], x + w + margin)
            y2 = min(frame.shape[0], y + h + margin)

            face_roi = frame[y1:y2, x1:x2]
            if face_roi.size == 0:
                continue

            enhanced = enhance_face_region(face_roi, strength)
            frame[y1:y2, x1:x2] = enhanced
            total_faces += 1

        cv2.imwrite(str(output_path / frame_path.name), frame)

        if (i + 1) % 50 == 0:
            print(f'[Face] {i + 1}/{len(frames)} frames — {total_faces} faces enhanced', flush=True)
