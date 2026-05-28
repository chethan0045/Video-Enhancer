import { Component, inject, ElementRef, ViewChild, AfterViewInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { JobService } from '../core/job.service';

@Component({
  selector: 'app-editor',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="editor-page">
      <header class="header">
        <button class="btn-back" (click)="goBack()">← Back</button>
        <h1>Video Editor</h1>
        <span class="file-name" *ngIf="videoFile">{{ videoFile.name }}</span>
        <div class="header-actions">
          <button class="btn-primary" (click)="applyAndContinue()" [disabled]="processing">
            {{ processing ? 'Creating Job...' : 'Apply & Start Enhancement →' }}
          </button>
        </div>
      </header>

      <div class="content">
        <div class="editor-layout">
          <!-- Video Preview -->
          <div class="preview-panel">
            <div class="video-container" #videoContainer>
              <video #videoEl
                [src]="videoUrl"
                preload="auto"
                (loadedmetadata)="onVideoLoaded()"
                (timeupdate)="onTimeUpdate()"
                (click)="togglePlay()"
              ></video>
              <!-- Crop overlay -->
              <div class="crop-overlay" *ngIf="showCropOverlay && videoReady"
                [style.left.px]="crop.x"
                [style.top.px]="crop.y"
                [style.width.px]="crop.width"
                [style.height.px]="crop.height"
                (mousedown)="onCropDragStart($event)"
              >
                <div class="crop-handle tl" (mousedown)="onCropResizeStart($event, 'tl')"></div>
                <div class="crop-handle tr" (mousedown)="onCropResizeStart($event, 'tr')"></div>
                <div class="crop-handle bl" (mousedown)="onCropResizeStart($event, 'bl')"></div>
                <div class="crop-handle br" (mousedown)="onCropResizeStart($event, 'br')"></div>
                <div class="crop-label">{{ crop.width }}×{{ crop.height }}</div>
              </div>
            </div>

            <!-- Playback controls -->
            <div class="playback-controls">
              <button class="ctrl-btn" (click)="togglePlay()">{{ playing ? '⏸' : '▶' }}</button>
              <span class="time-label">{{ formatTime(currentTime) }} / {{ formatTime(duration) }}</span>
              <input type="range" class="seek-bar" [min]="0" [max]="duration || 0" [step]="0.01"
                [value]="currentTime" (input)="seek($event)" />
            </div>
          </div>

          <!-- Controls Panel -->
          <div class="controls-panel">
            <!-- Trim Section -->
            <section class="control-section">
              <h3>
                <span>✂ Trim</span>
                <label class="toggle">
                  <input type="checkbox" [(ngModel)]="trimEnabled" />
                  <span class="slider"></span>
                </label>
              </h3>
              <div class="trim-controls" *ngIf="trimEnabled">
                <div class="trim-slider" #trimSlider>
                  <input type="range" class="trim-range trim-start" [min]="0" [max]="duration" [step]="0.1"
                    [(ngModel)]="trimStart" (input)="onTrimChange()" />
                  <input type="range" class="trim-range trim-end" [min]="0" [max]="duration" [step]="0.1"
                    [(ngModel)]="trimEnd" (input)="onTrimChange()" />
                  <div class="trim-zone" [style.left.%]="(trimStart/duration)*100" [style.width.%]="((trimEnd-trimStart)/duration)*100"></div>
                </div>
                <div class="trim-info">
                  <span>Start: {{ formatTime(trimStart) }}</span>
                  <span>End: {{ formatTime(trimEnd) }}</span>
                  <span>Duration: {{ formatTime(trimEnd - trimStart) }}</span>
                </div>
                <div class="trim-presets">
                  <button class="preset-btn" *ngFor="let p of trimPresets" (click)="applyTrimPreset(p)">{{ p.label }}</button>
                </div>
              </div>
            </section>

            <!-- Crop Section -->
            <section class="control-section">
              <h3>
                <span>⊞ Crop</span>
                <label class="toggle">
                  <input type="checkbox" [(ngModel)]="cropEnabled" (change)="onCropToggle()" />
                  <span class="slider"></span>
                </label>
              </h3>
              <div class="crop-controls" *ngIf="cropEnabled">
                <div class="crop-presets">
                  <button class="preset-btn" *ngFor="let p of cropPresets" (click)="applyCropPreset(p)">{{ p.label }}</button>
                </div>
                <div class="crop-inputs">
                  <label>X <input type="number" [(ngModel)]="crop.x" (input)="onCropInput()" /></label>
                  <label>Y <input type="number" [(ngModel)]="crop.y" (input)="onCropInput()" /></label>
                  <label>W <input type="number" [(ngModel)]="crop.width" (input)="onCropInput()" /></label>
                  <label>H <input type="number" [(ngModel)]="crop.height" (input)="onCropInput()" /></label>
                </div>
                <button class="btn-ghost" (click)="resetCrop()">Reset Crop</button>
              </div>
            </section>
          </div>
        </div>
      </div>
    </div>
  `,
  styles: [`
    .editor-page { min-height: 100vh; background: #0a0a0f; color: white; display: flex; flex-direction: column; }
    .header {
      display: flex; align-items: center; gap: 12px; padding: 12px 24px;
      border-bottom: 1px solid #1a1a2e; flex-shrink: 0;
    }
    .header h1 { font-size: 18px; font-weight: 600; }
    .file-name { font-size: 13px; color: #8888aa; flex: 1; }
    .header-actions { display: flex; gap: 8px; }
    .btn-back { background: transparent; border: 1px solid #2a2a3e; color: #8888aa; padding: 8px 16px; border-radius: 8px; cursor: pointer; }
    .btn-primary {
      padding: 10px 20px; background: linear-gradient(135deg, #e94560, #ff6b6b);
      border: none; border-radius: 10px; color: white; font-size: 14px; font-weight: 600; cursor: pointer; white-space: nowrap;
    }
    .btn-primary:disabled { opacity: 0.5; cursor: not-allowed; }
    .btn-ghost { background: transparent; border: 1px solid #2a2a3e; color: #8888aa; padding: 8px 16px; border-radius: 8px; cursor: pointer; font-size: 13px; }

    .content { flex: 1; padding: 24px; overflow: auto; }
    .editor-layout { display: grid; grid-template-columns: 1fr 340px; gap: 24px; max-width: 1400px; margin: 0 auto; height: 100%; }

    .preview-panel { display: flex; flex-direction: column; }
    .video-container {
      position: relative; background: #000; border-radius: 12px; overflow: hidden;
      border: 1px solid #1e1e30; flex: 1; min-height: 400px;
    }
    .video-container video { width: 100%; height: 100%; display: block; cursor: pointer; object-fit: contain; }

    .crop-overlay {
      position: absolute; border: 2px solid #e94560; background: rgba(233, 69, 96, 0.08);
      cursor: move; pointer-events: auto; z-index: 10;
    }
    .crop-handle {
      position: absolute; width: 12px; height: 12px; background: #e94560;
      border: 2px solid white; border-radius: 2px; z-index: 11;
    }
    .crop-handle.tl { top: -7px; left: -7px; cursor: nwse-resize; }
    .crop-handle.tr { top: -7px; right: -7px; cursor: nesw-resize; }
    .crop-handle.bl { bottom: -7px; left: -7px; cursor: nesw-resize; }
    .crop-handle.br { bottom: -7px; right: -7px; cursor: nwse-resize; }
    .crop-label {
      position: absolute; bottom: 4px; left: 50%; transform: translateX(-50%);
      font-size: 11px; background: rgba(0,0,0,0.7); padding: 2px 6px; border-radius: 3px; color: white; pointer-events: none;
    }

    .playback-controls {
      display: flex; align-items: center; gap: 12px; padding: 10px 16px;
      background: #14141f; border: 1px solid #1e1e30; border-radius: 10px; margin-top: 12px;
    }
    .ctrl-btn {
      width: 36px; height: 36px; display: flex; align-items: center; justify-content: center;
      background: #1e1e30; border: none; border-radius: 8px; color: white; font-size: 14px; cursor: pointer; flex-shrink: 0;
    }
    .ctrl-btn:hover { background: #2a2a3e; }
    .time-label { font-size: 12px; color: #8888aa; white-space: nowrap; flex-shrink: 0; }
    .seek-bar { flex: 1; accent-color: #e94560; height: 4px; }

    .controls-panel { display: flex; flex-direction: column; gap: 16px; }
    .control-section {
      background: #14141f; border: 1px solid #1e1e30; border-radius: 14px; padding: 18px;
    }
    .control-section h3 {
      display: flex; justify-content: space-between; align-items: center;
      font-size: 14px; font-weight: 600; margin-bottom: 14px;
    }

    .toggle { position: relative; display: inline-block; width: 40px; height: 22px; cursor: pointer; }
    .toggle input { display: none; }
    .slider {
      position: absolute; inset: 0; background: #2a2a3e; border-radius: 22px; transition: 0.3s;
    }
    .slider::before {
      content: ''; position: absolute; left: 3px; bottom: 3px; width: 16px; height: 16px;
      background: white; border-radius: 50%; transition: 0.3s;
    }
    .toggle input:checked + .slider { background: #e94560; }
    .toggle input:checked + .slider::before { transform: translateX(18px); }

    .trim-slider {
      position: relative; height: 36px; margin-bottom: 8px;
    }
    .trim-range {
      position: absolute; width: 100%; height: 36px; margin: 0;
      -webkit-appearance: none; appearance: none; background: transparent; pointer-events: none;
    }
    .trim-range::-webkit-slider-thumb {
      -webkit-appearance: none; width: 16px; height: 36px; background: #e94560;
      border: 2px solid white; border-radius: 4px; cursor: pointer; pointer-events: auto;
    }
    .trim-zone {
      position: absolute; top: 0; bottom: 0; background: rgba(233, 69, 96, 0.2);
      border-left: 2px solid #e94560; border-right: 2px solid #e94560; pointer-events: none;
    }
    .trim-info { display: flex; gap: 12px; font-size: 12px; color: #8888aa; margin-bottom: 10px; }
    .trim-presets, .crop-presets { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 10px; }
    .preset-btn {
      padding: 4px 10px; background: #1e1e30; border: 1px solid #2a2a3e;
      border-radius: 6px; color: #aaaacc; font-size: 11px; cursor: pointer;
    }
    .preset-btn:hover { border-color: #e94560; color: white; }

    .crop-inputs { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-bottom: 10px; }
    .crop-inputs label {
      display: flex; flex-direction: column; gap: 3px; font-size: 11px; color: #8888aa;
    }
    .crop-inputs input {
      background: #0a0a0f; border: 1px solid #2a2a3e; border-radius: 6px;
      padding: 6px 8px; color: white; font-size: 13px; width: 100%; outline: none;
    }
    .crop-inputs input:focus { border-color: #e94560; }
  `],
})
export class EditorComponent implements AfterViewInit, OnDestroy {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private jobService = inject(JobService);

  @ViewChild('videoEl') videoElRef!: ElementRef<HTMLVideoElement>;
  @ViewChild('videoContainer') containerRef!: ElementRef<HTMLDivElement>;

  videoFile: File | null = null;
  videoUrl: string = '';
  videoReady = false;
  playing = false;
  currentTime = 0;
  duration = 0;
  processing = false;

  trimEnabled = false;
  trimStart = 0;
  trimEnd = 0;

  cropEnabled = false;
  showCropOverlay = false;
  crop = { x: 0, y: 0, width: 200, height: 200 };

  private videoWidth = 0;
  private videoHeight = 0;
  private scaleX = 1;
  private scaleY = 1;
  private dragStart: { x: number; y: number; cx: number; cy: number } | null = null;
  private resizeStart: { x: number; y: number; corner: string; cx: number; cy: number; cw: number; ch: number } | null = null;
  private animationId: number | null = null;

  readonly trimPresets = [
    { label: 'First 15s', start: 0, end: 15 },
    { label: 'First 30s', start: 0, end: 30 },
    { label: 'Last 30s', start: null, end: null },
    { label: 'Middle', start: null, end: null },
  ];

  readonly cropPresets = [
    { label: '16:9', w: 1920, h: 1080 },
    { label: '4:3', w: 1440, h: 1080 },
    { label: '1:1', w: 1080, h: 1080 },
    { label: '9:16', w: 1080, h: 1920 },
    { label: 'Full', w: 0, h: 0 },
  ];

  ngAfterViewInit() {
    const id = this.route.snapshot.paramMap.get('id');
    const nav = this.router.getCurrentNavigation();
    const state = nav?.extras?.state as any;

    if (state?.file) {
      this.videoFile = state.file;
      this.videoUrl = URL.createObjectURL(state.file);
    } else if (id) {
      this.jobService.get(id).subscribe({
        next: (res) => {
          const job = res.job;
          this.videoUrl = this.getVideoUrl(job.inputPath, 'uploads');
          if (job.pipeline?.editor) {
            const e = job.pipeline.editor;
            if (e.trim?.enabled) {
              this.trimEnabled = true;
              this.trimStart = e.trim.start;
              this.trimEnd = e.trim.end;
            }
            if (e.crop?.enabled) {
              this.cropEnabled = true;
              this.showCropOverlay = true;
              if (e.crop.width) this.crop = { ...e.crop };
            }
          }
        },
      });
    }
  }

  ngOnDestroy() {
    if (this.videoUrl?.startsWith('blob:')) URL.revokeObjectURL(this.videoUrl);
    if (this.animationId) cancelAnimationFrame(this.animationId);
  }

  get videoEl(): HTMLVideoElement {
    return this.videoElRef?.nativeElement;
  }

  onVideoLoaded() {
    this.videoReady = true;
    this.duration = this.videoEl.duration || 0;
    this.trimEnd = this.duration;
    this.videoWidth = this.videoEl.videoWidth || 1280;
    this.videoHeight = this.videoEl.videoHeight || 720;
    this.updateScale();
    this.initCrop();
  }

  private updateScale() {
    const container = this.containerRef?.nativeElement;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    const videoAspect = this.videoWidth / this.videoHeight;
    let displayW: number, displayH: number;
    if (rect.width / rect.height > videoAspect) {
      displayH = rect.height;
      displayW = displayH * videoAspect;
    } else {
      displayW = rect.width;
      displayH = displayW / videoAspect;
    }
    this.scaleX = displayW / this.videoWidth;
    this.scaleY = displayH / this.videoHeight;
  }

  private initCrop() {
    this.crop = {
      x: Math.round(this.videoWidth * 0.1),
      y: Math.round(this.videoHeight * 0.1),
      width: Math.round(this.videoWidth * 0.8),
      height: Math.round(this.videoHeight * 0.8),
    };
  }

  onTimeUpdate() {
    this.currentTime = this.videoEl?.currentTime || 0;
  }

  togglePlay() {
    if (!this.videoEl) return;
    if (this.videoEl.paused) {
      this.videoEl.play().catch(() => {});
      this.playing = true;
      this.startFrameLoop();
    } else {
      this.videoEl.pause();
      this.playing = false;
      if (this.animationId) cancelAnimationFrame(this.animationId);
    }
  }

  private startFrameLoop() {
    const loop = () => {
      if (!this.videoEl?.paused) {
        this.currentTime = this.videoEl.currentTime;
        this.animationId = requestAnimationFrame(loop);
      }
    };
    this.animationId = requestAnimationFrame(loop);
  }

  seek(e: Event) {
    const t = parseFloat((e.target as HTMLInputElement).value);
    if (this.videoEl) this.videoEl.currentTime = t;
  }

  formatTime(s: number): string {
    if (!s || !isFinite(s)) return '0:00';
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${sec.toString().padStart(2, '0')}`;
  }

  onTrimChange() {
    if (this.trimStart >= this.trimEnd) {
      this.trimEnd = Math.min(this.trimStart + 1, this.duration);
    }
  }

  applyTrimPreset(p: { label: string; start: number | null; end: number | null }) {
    this.trimEnabled = true;
    if (p.start !== null && p.end !== null) {
      this.trimStart = p.start;
      this.trimEnd = Math.min(p.end, this.duration);
    } else if (p.label === 'Last 30s') {
      this.trimStart = Math.max(0, this.duration - 30);
      this.trimEnd = this.duration;
    } else if (p.label === 'Middle') {
      const mid = this.duration / 2;
      this.trimStart = Math.max(0, mid - 15);
      this.trimEnd = Math.min(this.duration, mid + 15);
    }
  }

  onCropToggle() {
    this.showCropOverlay = this.cropEnabled;
    if (this.cropEnabled) this.initCrop();
  }

  applyCropPreset(p: { label: string; w: number; h: number }) {
    this.cropEnabled = true;
    this.showCropOverlay = true;
    if (p.w === 0 && p.h === 0) {
      this.crop = { x: 0, y: 0, width: this.videoWidth, height: this.videoHeight };
      return;
    }
    const srcRatio = this.videoWidth / this.videoHeight;
    const dstRatio = p.w / p.h;
    let cw: number, ch: number;
    if (srcRatio > dstRatio) {
      ch = this.videoHeight;
      cw = ch * dstRatio;
    } else {
      cw = this.videoWidth;
      ch = cw / dstRatio;
    }
    this.crop = {
      x: Math.round((this.videoWidth - cw) / 2),
      y: Math.round((this.videoHeight - ch) / 2),
      width: Math.round(cw),
      height: Math.round(ch),
    };
  }

  onCropInput() {
    if (this.crop.x < 0) this.crop.x = 0;
    if (this.crop.y < 0) this.crop.y = 0;
    if (this.crop.x + this.crop.width > this.videoWidth) this.crop.width = this.videoWidth - this.crop.x;
    if (this.crop.y + this.crop.height > this.videoHeight) this.crop.height = this.videoHeight - this.crop.y;
  }

  resetCrop() {
    this.crop = { x: 0, y: 0, width: this.videoWidth, height: this.videoHeight };
  }

  onCropDragStart(e: MouseEvent) {
    e.preventDefault();
    this.dragStart = { x: e.clientX, y: e.clientY, cx: this.crop.x, cy: this.crop.y };
    const onMove = (ev: MouseEvent) => {
      if (!this.dragStart) return;
      const dx = Math.round((ev.clientX - this.dragStart.x) / this.scaleX);
      const dy = Math.round((ev.clientY - this.dragStart.y) / this.scaleY);
      this.crop.x = Math.max(0, Math.min(this.dragStart.cx + dx, this.videoWidth - this.crop.width));
      this.crop.y = Math.max(0, Math.min(this.dragStart.cy + dy, this.videoHeight - this.crop.height));
    };
    const onUp = () => {
      this.dragStart = null;
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }

  onCropResizeStart(e: MouseEvent, corner: string) {
    e.preventDefault();
    e.stopPropagation();
    this.resizeStart = { x: e.clientX, y: e.clientY, corner, cx: this.crop.x, cy: this.crop.y, cw: this.crop.width, ch: this.crop.height };
    const onMove = (ev: MouseEvent) => {
      if (!this.resizeStart) return;
      const dx = Math.round((ev.clientX - this.resizeStart.x) / this.scaleX);
      const dy = Math.round((ev.clientY - this.resizeStart.y) / this.scaleY);
      const r = this.resizeStart;
      let nx = r.cx, ny = r.cy, nw = r.cw, nh = r.ch;
      if (r.corner.includes('r')) { nw = r.cw + dx; }
      if (r.corner.includes('l')) { nx = r.cx + dx; nw = r.cw - dx; }
      if (r.corner.includes('b')) { nh = r.ch + dy; }
      if (r.corner.includes('t')) { ny = r.cy + dy; nh = r.ch - dy; }
      if (nw < 20) { nw = 20; if (r.corner.includes('l')) nx = r.cx + r.cw - 20; }
      if (nh < 20) { nh = 20; if (r.corner.includes('t')) ny = r.cy + r.ch - 20; }
      if (nx < 0) { nx = 0; }
      if (ny < 0) { ny = 0; }
      if (nx + nw > this.videoWidth) { nw = this.videoWidth - nx; }
      if (ny + nh > this.videoHeight) { nh = this.videoHeight - ny; }
      this.crop = { x: nx, y: ny, width: nw, height: nh };
    };
    const onUp = () => {
      this.resizeStart = null;
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }

  getVideoUrl(p: string, type: string): string {
    const idx = p.indexOf(`\\${type}\\`);
    if (idx !== -1) return p.slice(idx).replace(/\\/g, '/');
    const idx2 = p.indexOf(`/${type}/`);
    if (idx2 !== -1) return p.slice(idx2);
    const filename = p.split('\\').pop() || p.split('/').pop();
    return `/${type}/${filename}`;
  }

  goBack() {
    if (this.videoFile) {
      this.router.navigate(['/upload']);
    } else {
      this.router.navigate(['/dashboard']);
    }
  }

  async applyAndContinue() {
    if (this.processing) return;
    this.processing = true;

    try {
      const editorSettings: any = {
        editor: {
          trim: { enabled: this.trimEnabled, start: this.trimStart, end: this.trimEnd },
          crop: { enabled: this.cropEnabled, ...this.crop },
        },
      };

      if (this.videoFile) {
        const result = await firstValueFrom(
          this.jobService.create(
            this.videoFile.name.replace(/\.[^/.]+$/, ''),
            { pipeline: editorSettings },
            this.videoFile
          )
        );

        if (result?.job?._id) {
          this.router.navigate(['/processing', result.job._id]);
          return;
        }
      }

      const id = this.route.snapshot.paramMap.get('id');
      if (id) {
        await firstValueFrom(this.jobService.updatePipeline(id, editorSettings));
        this.router.navigate(['/processing', id]);
      }
    } catch (err) {
      console.error('Failed to apply edits:', err);
      this.processing = false;
    }
  }
}
