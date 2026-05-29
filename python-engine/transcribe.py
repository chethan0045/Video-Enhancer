#!/usr/bin/env python3
"""
Subtitle generation via faster-whisper (CPU-friendly Whisper).

Usage:
    python transcribe.py --input audio.wav --output subs.srt --model tiny --language auto

Emits "PROGRESS <pct>" lines on stdout for the Node worker. Exits 2 if
faster-whisper isn't installed so the caller can surface a clear message.
"""

import argparse
import sys


def fmt_ts(t):
    if t < 0:
        t = 0
    h = int(t // 3600)
    m = int((t % 3600) // 60)
    s = int(t % 60)
    ms = int(round((t - int(t)) * 1000))
    return f"{h:02d}:{m:02d}:{s:02d},{ms:03d}"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--input', required=True)
    ap.add_argument('--output', required=True)
    ap.add_argument('--model', default='tiny')
    ap.add_argument('--language', default='auto')
    args = ap.parse_args()

    try:
        from faster_whisper import WhisperModel
    except Exception as e:  # noqa: BLE001
        print(f'[transcribe] faster-whisper not installed: {e}', file=sys.stderr)
        sys.exit(2)

    language = None if args.language in ('auto', '', None) else args.language

    model = WhisperModel(args.model, device='cpu', compute_type='int8')
    segments, info = model.transcribe(args.input, language=language, vad_filter=True)

    total = getattr(info, 'duration', 0) or 0
    idx = 1
    with open(args.output, 'w', encoding='utf-8') as f:
        for seg in segments:
            text = (seg.text or '').strip()
            if not text:
                continue
            f.write(f"{idx}\n{fmt_ts(seg.start)} --> {fmt_ts(seg.end)}\n{text}\n\n")
            idx += 1
            if total > 0:
                print(f"PROGRESS {min(99, int(seg.end / total * 100))}", flush=True)

    print('DONE', flush=True)


if __name__ == '__main__':
    main()
