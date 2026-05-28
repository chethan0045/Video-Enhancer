#!/usr/bin/env python3
"""
CineRemaster AI Engine — Main Pipeline Orchestrator

Processes video through multi-stage AI enhancement pipeline:
  denoise → deblur → temporal → upscale → face → depth → fps → hdr → color → film → export

Usage:
    python run_pipeline.py --input video.mp4 --output ./output --job-id abc123 --config '{}'
"""

import argparse
import json
import os
import sys
import time
import subprocess
from pathlib import Path


def emit_progress(job_id, stage, progress, status, stage_status, stage_progress):
    """Send structured JSON progress to stdout for Node.js worker to parse."""
    msg = json.dumps({
        'type': 'progress',
        'jobId': job_id,
        'stage': stage,
        'progress': progress,
        'status': status,
        'stageStatus': stage_status,
        'stageProgress': stage_progress,
    })
    print(msg, flush=True)


def run_ffmpeg(cmd, description=''):
    """Run FFmpeg command and raise on failure."""
    print(f'[FFmpeg] {description}', flush=True)
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        print(f'[FFmpeg Error] {result.stderr}', flush=True)
        raise RuntimeError(f'FFmpeg failed: {result.stderr[:500]}')
    return result


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


def extract_frames(input_path, frames_dir, fps=None):
    """Extract video frames to PNG images."""
    print(f'[Extract] Extracting frames to {frames_dir}', flush=True)
    os.makedirs(frames_dir, exist_ok=True)

    cmd = ['ffmpeg', '-i', input_path, '-qscale:v', '2']
    if fps:
        cmd.extend(['-vf', f'fps={fps}'])
    cmd.append(os.path.join(frames_dir, '%08d.png'))

    run_ffmpeg(cmd, 'Extracting frames')
    frame_count = len(list(Path(frames_dir).glob('*.png')))
    print(f'[Extract] Extracted {frame_count} frames', flush=True)
    return frame_count


def rebuild_video(frames_dir, output_path, input_path, fps=24):
    """Rebuild video from processed frames with original audio."""
    print(f'[Rebuild] Rebuilding video to {output_path}', flush=True)
    
    temp_video = output_path.replace('.mp4', '_temp.mp4')
    
    cmd = [
        'ffmpeg', '-y',
        '-framerate', str(fps),
        '-i', os.path.join(frames_dir, '%08d.png'),
        '-c:v', 'libx265',
        '-preset', 'slow',
        '-crf', '18',
        '-pix_fmt', 'yuv420p10le',
        '-tag:v', 'hvc1',
        temp_video,
    ]
    run_ffmpeg(cmd, 'Building video from frames')

    cmd = [
        'ffmpeg', '-y',
        '-i', temp_video,
        '-i', input_path,
        '-c:v', 'copy',
        '-c:a', 'aac',
        '-b:a', '192k',
        '-map', '0:v:0',
        '-map', '1:a:0?',
        '-shortest',
        output_path,
    ]
    run_ffmpeg(cmd, 'Muxing audio')
    
    if os.path.exists(temp_video):
        os.remove(temp_video)


def main():
    parser = argparse.ArgumentParser(description='CineRemaster AI Pipeline')
    parser.add_argument('--input', required=True, help='Input video path')
    parser.add_argument('--output', required=True, help='Output directory')
    parser.add_argument('--job-id', required=True, help='Job ID')
    parser.add_argument('--config', default='{}', help='Pipeline configuration JSON')
    
    args = parser.parse_args()
    config = json.loads(args.config)
    
    input_path = args.input
    output_dir = Path(args.output)
    output_dir.mkdir(parents=True, exist_ok=True)
    frames_dir = output_dir / 'frames'
    processed_dir = output_dir / 'frames_processed'
    
    job_id = args.job_id
    
    try:
        # ── Stage 0: Extract metadata ──
        info = get_video_info(input_path)
        video_stream = next((s for s in info.get('streams', []) if s['codec_type'] == 'video'), {})
        width = int(video_stream.get('width', 0))
        height = int(video_stream.get('height', 0))
        fps = eval(video_stream.get('avg_frame_rate', '24/1'))
        duration = float(info.get('format', {}).get('duration', 0))
        print(f'[Info] {width}x{height} @ {fps:.2f} fps, {duration:.1f}s', flush=True)

        # ── Stage 1: Frame Extraction ──
        emit_progress(job_id, 'extract', 5, 'extracting', 'processing', 50)
        frame_count = extract_frames(input_path, frames_dir, fps=None)
        emit_progress(job_id, 'extract', 10, 'extracting', 'completed', 100)

        # ── Determine target resolution ──
        target = config.get('pipeline', {}).get('upscale', {}).get('target', '4k')
        scale_map = {'1080p': 1080, '2k': 1440, '4k': 2160, '8k': 4320}
        target_height = scale_map.get(target, 2160)
        upscale_factor = max(1, target_height // height) if height else 4

        # ── Stage 2: Denoise ──
        emit_progress(job_id, 'denoise', 15, 'processing', 'processing', 0)
        if config.get('pipeline', {}).get('denoise', {}).get('enabled', True):
            from modules.denoise import denoise_frames
            denoise_strength = config['pipeline']['denoise'].get('strength', 0.5)
            denoise_frames(frames_dir, frames_dir, strength=denoise_strength)
        emit_progress(job_id, 'denoise', 25, 'processing', 'completed', 100)

        # ── Stage 3: Deblur ──
        emit_progress(job_id, 'deblur', 30, 'processing', 'processing', 0)
        if config.get('pipeline', {}).get('deblur', {}).get('enabled', True):
            from modules.deblur import deblur_frames
            deblur_strength = config['pipeline']['deblur'].get('strength', 0.5)
            deblur_frames(frames_dir, frames_dir, strength=deblur_strength)
        emit_progress(job_id, 'deblur', 40, 'processing', 'completed', 100)

        # ── Stage 4: Temporal Enhancement ──
        emit_progress(job_id, 'temporal', 42, 'enhancing', 'processing', 0)
        if config.get('pipeline', {}).get('temporal', {}).get('enabled', True):
            from modules.temporal import temporal_enhance
            temporal_enhance(frames_dir, frames_dir)
        emit_progress(job_id, 'temporal', 50, 'enhancing', 'completed', 100)

        # ── Stage 5: Upscale ──
        emit_progress(job_id, 'upscale', 52, 'enhancing', 'processing', 0)
        if config.get('pipeline', {}).get('upscale', {}).get('enabled', True):
            model_name = config['pipeline']['upscale'].get('model', 'Real-ESRGAN')
            from modules.upscale import upscale_frames
            upscale_frames(frames_dir, frames_dir, scale=upscale_factor, model=model_name)
        emit_progress(job_id, 'upscale', 65, 'enhancing', 'completed', 100)

        # ── Stage 6: Face Restoration ──
        emit_progress(job_id, 'face_restore', 67, 'enhancing', 'processing', 0)
        if config.get('pipeline', {}).get('faceRestore', {}).get('enabled', True):
            face_strength = config['pipeline']['faceRestore'].get('strength', 0.6)
            face_model = config['pipeline']['faceRestore'].get('model', 'CodeFormer')
            from modules.face_restore import restore_faces
            restore_faces(frames_dir, frames_dir, strength=face_strength, model=face_model)
        emit_progress(job_id, 'face_restore', 75, 'enhancing', 'completed', 100)

        # ── Stage 7: Depth Simulation ──
        emit_progress(job_id, 'depth_simulation', 77, 'enhancing', 'processing', 0)
        if config.get('pipeline', {}).get('depthSimulation', {}).get('enabled', False):
            blur_strength = config['pipeline']['depthSimulation'].get('blurStrength', 0.3)
            from modules.depth_sim import apply_depth_of_field
            apply_depth_of_field(frames_dir, frames_dir, blur_strength=blur_strength)
        emit_progress(job_id, 'depth_simulation', 80, 'enhancing', 'completed', 100)

        # ── Stage 8: FPS Interpolation ──
        emit_progress(job_id, 'fps_interpolation', 81, 'enhancing', 'processing', 0)
        if config.get('pipeline', {}).get('fpsInterpolation', {}).get('enabled', False):
            target_fps = config['pipeline']['fpsInterpolation'].get('targetFps', 60)
            from modules.interpolation import interpolate_frames
            frames_dir = interpolate_frames(frames_dir, frames_dir, source_fps=fps, target_fps=target_fps)
            fps = target_fps
        emit_progress(job_id, 'fps_interpolation', 83, 'enhancing', 'completed', 100)

        # ── Stage 9: HDR Reconstruction ──
        emit_progress(job_id, 'hdr', 84, 'enhancing', 'processing', 0)
        if config.get('pipeline', {}).get('hdr', {}).get('enabled', True):
            hdr_strength = config['pipeline']['hdr'].get('strength', 0.7)
            from modules.hdr import apply_hdr
            apply_hdr(frames_dir, frames_dir, strength=hdr_strength)
        emit_progress(job_id, 'hdr', 88, 'enhancing', 'completed', 100)

        # ── Stage 10: Color Grading ──
        emit_progress(job_id, 'color_grading', 89, 'enhancing', 'processing', 0)
        if config.get('pipeline', {}).get('colorGrading', {}).get('enabled', True):
            lut = config['pipeline']['colorGrading'].get('lut', 'cinematic')
            warmth = config['pipeline']['colorGrading'].get('warmth', 0)
            contrast = config['pipeline']['colorGrading'].get('contrast', 0.2)
            saturation = config['pipeline']['colorGrading'].get('saturation', 0.1)
            from modules.color_grade import apply_color_grading
            apply_color_grading(frames_dir, frames_dir, lut=lut, warmth=warmth,
                                contrast=contrast, saturation=saturation)
        emit_progress(job_id, 'color_grading', 93, 'enhancing', 'completed', 100)

        # ── Stage 11: Film Texture ──
        emit_progress(job_id, 'film_texture', 94, 'enhancing', 'processing', 0)
        if config.get('pipeline', {}).get('filmTexture', {}).get('enabled', False):
            texture_type = config['pipeline']['filmTexture'].get('type', 'grain_light')
            from modules.film_texture import apply_film_texture
            apply_film_texture(frames_dir, frames_dir, texture_type=texture_type)
        emit_progress(job_id, 'film_texture', 95, 'enhancing', 'completed', 100)

        # ── Stage 12: Export ──
        emit_progress(job_id, 'export', 96, 'exporting', 'processing', 0)
        output_path = str(output_dir / 'output.mp4')
        rebuild_video(frames_dir, output_path, input_path, fps=fps)
        emit_progress(job_id, 'export', 100, 'completed', 'completed', 100)

        print(json.dumps({'type': 'complete', 'jobId': job_id, 'output': output_path}), flush=True)

    except Exception as e:
        print(f'[Error] Pipeline failed: {str(e)}', flush=True)
        emit_progress(job_id, 'error', 0, 'failed', 'failed', 0)
        sys.exit(1)


if __name__ == '__main__':
    main()
