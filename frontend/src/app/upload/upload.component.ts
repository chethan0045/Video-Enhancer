import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { UploadService } from '../core/upload.service';
import { JobService } from '../core/job.service';

@Component({
  selector: 'app-upload',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  template: `
    <div class="upload-page">
      <header class="header">
        <button class="btn-back" routerLink="/dashboard">← Back</button>
        <h1>New Enhancement</h1>
      </header>

      <div class="content">
        <div class="upload-zone" (dragover)="onDragOver($event)" (drop)="onDrop($event)"
             [class.has-file]="selectedFile" [class.dragging]="isDragging">
          <div *ngIf="!selectedFile" class="upload-placeholder">
            <div class="icon">📁</div>
            <h3>Drop your video here</h3>
            <p>MP4, MOV, AVI, MKV — up to 2GB</p>
            <input type="file" #fileInput accept="video/*" (change)="onFileSelected($event)" hidden />
            <button class="btn-outline" (click)="fileInput.click()">Browse Files</button>
          </div>

          <div *ngIf="selectedFile" class="file-info">
            <div class="file-icon">🎬</div>
            <div class="file-details">
              <h4>{{ selectedFile.name }}</h4>
              <p>{{ formatSize(selectedFile.size) }}</p>
            </div>
            <button class="btn-ghost" (click)="selectedFile = null">Remove</button>
          </div>
        </div>

        <div class="settings-panel" *ngIf="selectedFile">
          <h3>Enhancement Settings</h3>

          <div class="engine-toggle">
            <button type="button" class="engine-opt" [class.active]="settings.engine === 'fast'" (click)="settings.engine = 'fast'">
              <strong>⚡ Fast</strong>
              <span>FFmpeg, hardware-accelerated. Instant, runs anywhere.</span>
            </button>
            <button type="button" class="engine-opt" [class.active]="settings.engine === 'ai'" (click)="settings.engine = 'ai'">
              <strong>🧠 AI (GPU)</strong>
              <span>Real-ESRGAN + face restoration. Best quality; needs the GPU endpoint.</span>
            </button>
          </div>
          <p class="engine-note" *ngIf="settings.engine === 'ai'">
            AI mode runs on the RunPod GPU worker. If it isn't configured, the job automatically falls back to Fast mode.
          </p>

          <div class="settings-grid">
            <div class="setting">
              <label>Title</label>
              <input type="text" [(ngModel)]="title" placeholder="My Video" />
            </div>

            <div class="setting">
              <label>Target Resolution</label>
              <select [(ngModel)]="settings.upscale.target">
                <option value="8k">8K — Clean &amp; Sharp (recommended)</option>
                <option value="4k">4K UHD</option>
                <option value="1080p">1080p Full HD</option>
              </select>
            </div>

            <div class="setting">
              <label>Upscale Model</label>
              <select [(ngModel)]="settings.upscale.model">
                <option value="Real-ESRGAN">Real-ESRGAN</option>
                <option value="BSRGAN">BSRGAN</option>
                <option value="SwinIR">SwinIR</option>
              </select>
            </div>

            <div class="setting">
              <label>Denoise Strength</label>
              <input type="range" min="0" max="1" step="0.1" [(ngModel)]="settings.denoise.strength" />
              <span class="value">{{ settings.denoise.strength }}</span>
            </div>

            <div class="setting">
              <label>Face Enhancement</label>
              <input type="range" min="0" max="1" step="0.1" [(ngModel)]="settings.faceRestore.strength" />
              <span class="value">{{ settings.faceRestore.strength }}</span>
            </div>

            <div class="setting">
              <label>HDR Effect</label>
              <input type="range" min="0" max="1" step="0.1" [(ngModel)]="settings.hdr.strength" />
              <span class="value">{{ settings.hdr.strength }}</span>
            </div>

            <div class="setting checkbox">
              <label>
                <input type="checkbox" [(ngModel)]="settings.fpsInterpolation.enabled" />
                Frame Interpolation (60 FPS)
              </label>
            </div>

            <div class="setting checkbox">
              <label>
                <input type="checkbox" [(ngModel)]="settings.depthSimulation.enabled" />
                Depth-of-Field Simulation
              </label>
            </div>

            <div class="setting full">
              <label>Color Grade</label>
              <select [(ngModel)]="settings.colorGrading.lut">
                <option value="cinematic">Cinematic</option>
                <option value="teal_orange">Teal & Orange</option>
                <option value="warm">Warm Film</option>
                <option value="cool">Cool Modern</option>
                <option value="vintage">Vintage Film</option>
                <option value="hdr">HDR Cinema</option>
              </select>
            </div>
          </div>

          <div class="edit-actions">
            <button class="btn-primary btn-start" (click)="startEnhancement()" [disabled]="processing">
              {{ processing ? 'Creating Job...' : 'Start AI Enhancement →' }}
            </button>
          </div>
          <p class="edit-hint">Want to trim or crop instead? Use the <a routerLink="/editor">Edit Video</a> tool.</p>
        </div>
      </div>
    </div>
  `,
  styles: [`
    .upload-page { min-height: 100vh; background: #0a0a0f; color: white; }
    .header {
      display: flex; align-items: center; gap: 16px; padding: 16px 32px;
      border-bottom: 1px solid #1a1a2e;
    }
    .header h1 { font-size: 18px; font-weight: 600; }
    .btn-back { background: transparent; border: 1px solid #2a2a3e; color: #8888aa; padding: 8px 16px; border-radius: 8px; cursor: pointer; }
    .content { max-width: 800px; margin: 0 auto; padding: 32px; }
    .upload-zone {
      border: 2px dashed #2a2a3e; border-radius: 24px; padding: 64px;
      text-align: center; transition: all 0.3s; cursor: pointer;
    }
    .upload-zone:hover, .upload-zone.dragging { border-color: #e94560; background: #1a1015; }
    .upload-zone.has-file { border-style: solid; padding: 24px; }
    .upload-placeholder .icon { font-size: 48px; margin-bottom: 16px; }
    .upload-placeholder h3 { font-size: 18px; margin-bottom: 8px; }
    .upload-placeholder p { color: #8888aa; margin-bottom: 20px; font-size: 14px; }
    .btn-outline {
      padding: 12px 24px; background: transparent; border: 1px solid #2a2a3e;
      border-radius: 10px; color: white; cursor: pointer;
    }
    .btn-ghost { background: transparent; border: 1px solid #2a2a3e; color: #8888aa; padding: 8px 16px; border-radius: 8px; cursor: pointer; }
    .file-info { display: flex; align-items: center; gap: 16px; }
    .file-icon { font-size: 32px; }
    .file-details { flex: 1; text-align: left; }
    .file-details h4 { font-size: 15px; margin-bottom: 4px; }
    .file-details p { font-size: 13px; color: #8888aa; }
    .settings-panel { margin-top: 32px; }
    .settings-panel h3 { font-size: 18px; font-weight: 600; margin-bottom: 20px; }
    .engine-toggle { display: flex; gap: 12px; margin-bottom: 8px; }
    .engine-opt {
      flex: 1; text-align: left; background: #14141f; border: 1px solid #2a2a3e;
      border-radius: 12px; padding: 14px 16px; cursor: pointer; transition: all 0.2s; color: #aaaacc;
    }
    .engine-opt strong { display: block; font-size: 14px; color: white; margin-bottom: 4px; }
    .engine-opt span { font-size: 12px; line-height: 1.4; }
    .engine-opt.active { border-color: #e94560; background: #1e1018; }
    .engine-note { font-size: 12px; color: #8888aa; margin: 0 0 16px; }
    .settings-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
    .setting { display: flex; flex-direction: column; gap: 6px; }
    .setting.full { grid-column: 1 / -1; }
    .setting label { font-size: 13px; color: #aaaacc; font-weight: 500; }
    .setting input[type="text"], .setting select {
      background: #14141f; border: 1px solid #2a2a3e; border-radius: 10px;
      padding: 10px 14px; color: white; font-size: 14px; outline: none;
    }
    .setting input[type="range"] { width: 100%; accent-color: #e94560; }
    .setting .value { font-size: 13px; color: #e94560; font-weight: 600; }
    .setting.checkbox label { display: flex; align-items: center; gap: 8px; cursor: pointer; }
    .setting.checkbox input { accent-color: #e94560; width: 18px; height: 18px; }
    .edit-actions {
      display: flex; gap: 12px; margin-top: 24px; grid-column: 1 / -1;
    }
    .edit-actions button { flex: 1; padding: 14px; font-size: 15px; }
    .edit-hint { margin-top: 14px; text-align: center; font-size: 13px; color: #8888aa; }
    .edit-hint a { color: #e94560; text-decoration: none; font-weight: 600; }
    .edit-hint a:hover { text-decoration: underline; }
    .btn-start {
      background: linear-gradient(135deg, #e94560, #ff6b6b);
      border: none; border-radius: 12px; color: white; font-weight: 600; cursor: pointer;
    }
    .btn-start:disabled { opacity: 0.5; cursor: not-allowed; }
  `],
})
export class UploadComponent {
  private uploadService = inject(UploadService);
  private jobService = inject(JobService);
  private router = inject(Router);

  selectedFile: File | null = null;
  isDragging = false;
  processing = false;
  title = '';

  settings: any = {
    engine: 'fast',
    denoise: { enabled: true, strength: 0.5 },
    deblur: { enabled: true, strength: 0.5 },
    upscale: { enabled: true, target: '8k', model: 'Real-ESRGAN' },
    temporal: { enabled: true, model: 'BasicVSR++' },
    faceRestore: { enabled: true, model: 'CodeFormer', strength: 0.6 },
    depthSimulation: { enabled: false, blurStrength: 0.3 },
    fpsInterpolation: { enabled: false, targetFps: 60 },
    hdr: { enabled: true, strength: 0.7 },
    colorGrading: { enabled: true, lut: 'cinematic', warmth: 0, contrast: 0.2, saturation: 0.1 },
    filmTexture: { enabled: false, type: 'grain_light' },
  };

  formatSize(bytes: number): string {
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  }

  onDragOver(e: DragEvent) {
    e.preventDefault();
    this.isDragging = true;
  }

  onDrop(e: DragEvent) {
    e.preventDefault();
    this.isDragging = false;
    const file = e.dataTransfer?.files[0];
    if (file && file.type.startsWith('video/')) {
      this.selectedFile = file;
      this.title = file.name.replace(/\.[^/.]+$/, '');
    }
  }

  onFileSelected(e: any) {
    const file = e.target.files?.[0];
    if (file) {
      this.selectedFile = file;
      this.title = file.name.replace(/\.[^/.]+$/, '');
    }
  }

  async startEnhancement() {
    if (!this.selectedFile) return;
    this.processing = true;
    try {
      const result = await firstValueFrom(
        this.jobService.create(this.title || 'Untitled', { pipeline: this.settings }, this.selectedFile, 'enhance')
      );
      if (result?.job?._id) this.router.navigate(['/processing', result.job._id]);
    } catch (err) {
      console.error('Upload failed:', err);
      this.processing = false;
    }
  }
}
