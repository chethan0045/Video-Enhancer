"""
CUDA acceleration utilities for PyTorch-based models.
"""

import torch


def get_device():
    """Get the best available compute device."""
    if torch.cuda.is_available():
        device = torch.device('cuda')
        gpu_name = torch.cuda.get_device_name(0)
        vram = torch.cuda.get_device_properties(0).total_mem / 1024**3
        print(f'[CUDA] Using {gpu_name} ({vram:.1f} GB VRAM)', flush=True)
        return device
    else:
        print('[CUDA] CUDA not available, using CPU', flush=True)
        return torch.device('cpu')


def get_optimal_batch_size(device, model_size_mb=100):
    """Calculate optimal batch size based on available VRAM."""
    if device.type == 'cuda':
        vram = torch.cuda.get_device_properties(0).total_mem / 1024**3
        free_vram = vram * 0.8
        batch_size = max(1, int(free_vram * 1024 / model_size_mb))
        return min(batch_size, 32)
    return 1
