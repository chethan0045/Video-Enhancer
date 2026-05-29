import { Component, inject, ElementRef, ViewChild, AfterViewInit, OnDestroy, ChangeDetectorRef, NgZone } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { JobService } from '../core/job.service';

interface Rect { left: number; top: number; width: number; height: number; }

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
          <button class="btn-primary" (click)="applyAndExport()" [disabled]="processing || !videoUrl">
            {{ processing ? 'Exporting…' : 'Apply & Export Clip →' }}
          </button>
        </div>
      </header>

      <div class="content">
        <!-- File picker -->
        <div class="dropzone" *ngIf="!videoUrl"
             (dragover)="onDragOver($event)" (dragleave)="isDragging = false" (drop)="onDrop($event)"
             [class.dragging]="isDragging">
          <div class="icon">✂</div>
          <h3>Drop a video to edit</h3>
          <p>Trim and crop your clip, then export it — no AI enhancement is applied.</p>
          <input type="file" #fileInput accept="video/*" (change)="onFileSelected($event)" hidden />
          <button class="btn-outline" (click)="fileInput.click()">Browse Files</button>
        </div>

        <div class="editor-layout" *ngIf="videoUrl">
          <div class="stage">
            <!-- Video + crop overlay -->
            <div class="video-container" #videoContainer>
              <video #videoEl [src]="videoUrl" preload="auto" playsinline
                (loadedmetadata)="onVideoLoaded()" (timeupdate)="onTimeUpdate()"
                (play)="playing = true" (pause)="playing = false" (click)="togglePlay()"></video>

              <ng-container *ngIf="cropEnabled && videoReady">
                <!-- darkened mask outside the crop region -->
                <div class="crop-mask" [style.left.px]="cropBox.left" [style.top.px]="cropBox.top"
                     [style.width.px]="cropBox.width" [style.height.px]="cropBox.height"></div>
                <div class="crop-box" [style.left.px]="cropBox.left" [style.top.px]="cropBox.top"
                     [style.width.px]="cropBox.width" [style.height.px]="cropBox.height"
                     (mousedown)="onCropMoveStart($event)">
                  <div class="grid-v"></div><div class="grid-h"></div>
                  <div class="h tl" (mousedown)="onCropResizeStart($event,'tl')"></div>
                  <div class="h tr" (mousedown)="onCropResizeStart($event,'tr')"></div>
                  <div class="h bl" (mousedown)="onCropResizeStart($event,'bl')"></div>
                  <div class="h br" (mousedown)="onCropResizeStart($event,'br')"></div>
                  <div class="h t" (mousedown)="onCropResizeStart($event,'t')"></div>
                  <div class="h b" (mousedown)="onCropResizeStart($event,'b')"></div>
                  <div class="h l" (mousedown)="onCropResizeStart($event,'l')"></div>
                  <div class="h r" (mousedown)="onCropResizeStart($event,'r')"></div>
                  <span class="dim">{{ crop.width }} × {{ crop.height }}</span>
                </div>
              </ng-container>
            </div>

            <!-- Transport -->
            <div class="transport">
              <button class="ctrl-btn" (click)="togglePlay()">{{ playing ? '⏸' : '▶' }}</button>
              <button class="ctrl-btn" (click)="seekTo(trimStart); ">⏮</button>
              <span class="time">{{ formatTime(currentTime) }} / {{ formatTime(duration) }}</span>
            </div>

            <!-- Timeline / filmstrip -->
            <div class="timeline" #timeline (mousedown)="onTimelineClick($event)">
              <div class="filmstrip">
                <div class="thumb" *ngFor="let t of thumbnails"
                     [style.background-image]="t ? 'url(' + t + ')' : null"></div>
                <div class="thumb placeholder" *ngIf="!thumbnails.length" >loading frames…</div>
              </div>
              <!-- dim outside the trim selection -->
              <div class="tl-dim" [style.left.px]="0" [style.width.%]="pct(trimStart)"></div>
              <div class="tl-dim" [style.left.%]="pct(trimEnd)" [style.right.px]="0"></div>
              <!-- selection + handles -->
              <div class="tl-sel" [style.left.%]="pct(trimStart)" [style.width.%]="pct(trimEnd) - pct(trimStart)"></div>
              <div class="tl-handle start" [style.left.%]="pct(trimStart)" (mousedown)="onTrimDown($event,'start')"></div>
              <div class="tl-handle end" [style.left.%]="pct(trimEnd)" (mousedown)="onTrimDown($event,'end')"></div>
              <!-- playhead -->
              <div class="playhead" [style.left.%]="pct(currentTime)"></div>
            </div>
            <div class="tl-info">
              <span>In {{ formatTime(trimStart) }}</span>
              <span class="sel-dur">Selection {{ formatTime(trimEnd - trimStart) }}</span>
              <span>Out {{ formatTime(trimEnd) }}</span>
            </div>
          </div>

          <!-- Side controls -->
          <div class="controls-panel">
            <section class="control-section">
              <h3><span>✂ Trim</span></h3>
              <p class="hint">Drag the handles on the timeline, or set exact times:</p>
              <div class="num-row">
                <label>In<input type="number" min="0" [max]="trimEnd" step="0.1" [(ngModel)]="trimStart" (change)="clampTrim()" /></label>
                <label>Out<input type="number" [min]="trimStart" [max]="duration" step="0.1" [(ngModel)]="trimEnd" (change)="clampTrim()" /></label>
              </div>
              <div class="presets">
                <button class="preset-btn" (click)="setIn()">Set In ⟦</button>
                <button class="preset-btn" (click)="setOut()">⟧ Set Out</button>
                <button class="preset-btn" (click)="resetTrim()">Reset</button>
              </div>
            </section>

            <section class="control-section">
              <h3>
                <span>⊞ Crop</span>
                <label class="toggle"><input type="checkbox" [(ngModel)]="cropEnabled" (change)="onCropToggle()" /><span class="sl"></span></label>
              </h3>
              <div *ngIf="cropEnabled">
                <p class="hint">Drag the box / handles on the video, or pick a ratio:</p>
                <div class="presets">
                  <button class="preset-btn" *ngFor="let p of cropPresets" (click)="applyCropPreset(p)">{{ p.label }}</button>
                </div>
                <div class="num-grid">
                  <label>X<input type="number" [(ngModel)]="crop.x" (change)="clampCrop()" /></label>
                  <label>Y<input type="number" [(ngModel)]="crop.y" (change)="clampCrop()" /></label>
                  <label>W<input type="number" [(ngModel)]="crop.width" (change)="clampCrop()" /></label>
                  <label>H<input type="number" [(ngModel)]="crop.height" (change)="clampCrop()" /></label>
                </div>
                <button class="btn-ghost" (click)="resetCrop()">Reset Crop</button>
              </div>
            </section>

            <div class="src-info" *ngIf="videoReady">Source: {{ videoWidth }} × {{ videoHeight }} · {{ formatTime(duration) }}</div>
          </div>
        </div>
      </div>
    </div>
  `,
  styles: [`
    .editor-page { min-height: 100vh; background: #0a0a0f; color: #fff; display: flex; flex-direction: column; }
    .header { display: flex; align-items: center; gap: 12px; padding: 12px 24px; border-bottom: 1px solid #1a1a2e; flex-shrink: 0; }
    .header h1 { font-size: 18px; font-weight: 600; }
    .file-name { font-size: 13px; color: #8888aa; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .header-actions { margin-left: auto; }
    .btn-back { background: transparent; border: 1px solid #2a2a3e; color: #8888aa; padding: 8px 16px; border-radius: 8px; cursor: pointer; }
    .btn-primary { padding: 10px 20px; background: linear-gradient(135deg,#e94560,#ff6b6b); border: none; border-radius: 10px; color: #fff; font-weight: 600; cursor: pointer; white-space: nowrap; }
    .btn-primary:disabled { opacity: .5; cursor: not-allowed; }
    .btn-ghost { background: transparent; border: 1px solid #2a2a3e; color: #aaaacc; padding: 8px 14px; border-radius: 8px; cursor: pointer; font-size: 13px; }
    .content { flex: 1; padding: 20px 24px; overflow: auto; }
    .dropzone { max-width: 640px; margin: 48px auto; padding: 64px 32px; text-align: center; border: 2px dashed #2a2a3e; border-radius: 24px; transition: .2s; }
    .dropzone.dragging { border-color: #e94560; background: #1a1015; }
    .dropzone .icon { font-size: 44px; margin-bottom: 16px; }
    .dropzone h3 { font-size: 18px; margin-bottom: 8px; }
    .dropzone p { color: #8888aa; font-size: 14px; margin-bottom: 20px; }
    .btn-outline { padding: 12px 24px; background: transparent; border: 1px solid #2a2a3e; border-radius: 10px; color: #fff; cursor: pointer; }
    .btn-outline:hover { border-color: #e94560; }

    .editor-layout { display: grid; grid-template-columns: 1fr 320px; gap: 20px; max-width: 1500px; margin: 0 auto; }
    .stage { min-width: 0; }
    .video-container { position: relative; background: #000; border-radius: 12px; overflow: hidden; border: 1px solid #1e1e30; height: 56vh; }
    .video-container video { width: 100%; height: 100%; display: block; object-fit: contain; cursor: pointer; }

    .crop-mask { position: absolute; box-shadow: 0 0 0 9999px rgba(0,0,0,.6); pointer-events: none; z-index: 5; }
    .crop-box { position: absolute; border: 1px solid #fff; box-sizing: border-box; cursor: move; z-index: 6; }
    .crop-box .grid-v { position: absolute; left: 33.33%; right: 33.33%; top: 0; bottom: 0; border-left: 1px solid rgba(255,255,255,.3); border-right: 1px solid rgba(255,255,255,.3); }
    .crop-box .grid-h { position: absolute; top: 33.33%; bottom: 33.33%; left: 0; right: 0; border-top: 1px solid rgba(255,255,255,.3); border-bottom: 1px solid rgba(255,255,255,.3); }
    .crop-box .h { position: absolute; background: #e94560; z-index: 7; }
    .crop-box .h.tl,.crop-box .h.tr,.crop-box .h.bl,.crop-box .h.br { width: 12px; height: 12px; border: 2px solid #fff; border-radius: 2px; }
    .crop-box .h.tl { top: -6px; left: -6px; cursor: nwse-resize; }
    .crop-box .h.tr { top: -6px; right: -6px; cursor: nesw-resize; }
    .crop-box .h.bl { bottom: -6px; left: -6px; cursor: nesw-resize; }
    .crop-box .h.br { bottom: -6px; right: -6px; cursor: nwse-resize; }
    .crop-box .h.t { top: -4px; left: 12px; right: 12px; height: 7px; cursor: ns-resize; }
    .crop-box .h.b { bottom: -4px; left: 12px; right: 12px; height: 7px; cursor: ns-resize; }
    .crop-box .h.l { left: -4px; top: 12px; bottom: 12px; width: 7px; cursor: ew-resize; }
    .crop-box .h.r { right: -4px; top: 12px; bottom: 12px; width: 7px; cursor: ew-resize; }
    .crop-box .dim { position: absolute; bottom: 4px; left: 50%; transform: translateX(-50%); font-size: 11px; background: rgba(0,0,0,.7); padding: 2px 6px; border-radius: 3px; white-space: nowrap; }

    .transport { display: flex; align-items: center; gap: 12px; margin-top: 12px; }
    .ctrl-btn { width: 38px; height: 38px; display: flex; align-items: center; justify-content: center; background: #1e1e30; border: none; border-radius: 8px; color: #fff; font-size: 14px; cursor: pointer; }
    .ctrl-btn:hover { background: #2a2a3e; }
    .time { font-size: 13px; color: #8888aa; }

    .timeline { position: relative; height: 64px; margin-top: 12px; border-radius: 8px; overflow: hidden; background: #14141f; border: 1px solid #1e1e30; cursor: pointer; user-select: none; }
    .filmstrip { position: absolute; inset: 0; display: flex; }
    .filmstrip .thumb { flex: 1; background-size: cover; background-position: center; border-right: 1px solid rgba(0,0,0,.3); }
    .filmstrip .placeholder { display: flex; align-items: center; justify-content: center; color: #555577; font-size: 12px; }
    .tl-dim { position: absolute; top: 0; bottom: 0; background: rgba(10,10,15,.7); pointer-events: none; }
    .tl-sel { position: absolute; top: 0; bottom: 0; border: 2px solid #e94560; box-sizing: border-box; pointer-events: none; }
    .tl-handle { position: absolute; top: 0; bottom: 0; width: 12px; margin-left: -6px; background: #e94560; cursor: ew-resize; z-index: 3; border-radius: 3px; }
    .tl-handle::after { content: ''; position: absolute; top: 50%; left: 50%; transform: translate(-50%,-50%); width: 2px; height: 18px; background: #fff; border-radius: 1px; }
    .playhead { position: absolute; top: 0; bottom: 0; width: 2px; margin-left: -1px; background: #fff; z-index: 4; pointer-events: none; box-shadow: 0 0 4px rgba(0,0,0,.8); }
    .tl-info { display: flex; justify-content: space-between; font-size: 12px; color: #8888aa; margin-top: 6px; }
    .tl-info .sel-dur { color: #e94560; font-weight: 600; }

    .controls-panel { display: flex; flex-direction: column; gap: 16px; }
    .control-section { background: #14141f; border: 1px solid #1e1e30; border-radius: 14px; padding: 16px; }
    .control-section h3 { display: flex; justify-content: space-between; align-items: center; font-size: 14px; font-weight: 600; margin-bottom: 12px; }
    .hint { font-size: 12px; color: #8888aa; margin: 0 0 10px; line-height: 1.4; }
    .toggle { position: relative; width: 40px; height: 22px; cursor: pointer; }
    .toggle input { display: none; }
    .sl { position: absolute; inset: 0; background: #2a2a3e; border-radius: 22px; transition: .3s; }
    .sl::before { content: ''; position: absolute; left: 3px; bottom: 3px; width: 16px; height: 16px; background: #fff; border-radius: 50%; transition: .3s; }
    .toggle input:checked + .sl { background: #e94560; }
    .toggle input:checked + .sl::before { transform: translateX(18px); }
    .num-row, .num-grid { display: grid; gap: 8px; margin-bottom: 10px; }
    .num-row { grid-template-columns: 1fr 1fr; }
    .num-grid { grid-template-columns: 1fr 1fr; }
    .num-row label, .num-grid label { display: flex; flex-direction: column; gap: 3px; font-size: 11px; color: #8888aa; }
    .num-row input, .num-grid input { background: #0a0a0f; border: 1px solid #2a2a3e; border-radius: 6px; padding: 6px 8px; color: #fff; font-size: 13px; outline: none; }
    .num-row input:focus, .num-grid input:focus { border-color: #e94560; }
    .presets { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 10px; }
    .preset-btn { padding: 5px 10px; background: #1e1e30; border: 1px solid #2a2a3e; border-radius: 6px; color: #aaaacc; font-size: 11px; cursor: pointer; }
    .preset-btn:hover { border-color: #e94560; color: #fff; }
    .src-info { font-size: 12px; color: #666688; text-align: center; }
  `],
})
export class EditorComponent implements AfterViewInit, OnDestroy {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private jobService = inject(JobService);
  private cdr = inject(ChangeDetectorRef);
  private zone = inject(NgZone);

  @ViewChild('videoEl') videoElRef!: ElementRef<HTMLVideoElement>;
  @ViewChild('videoContainer') containerRef!: ElementRef<HTMLDivElement>;
  @ViewChild('timeline') timelineRef!: ElementRef<HTMLDivElement>;

  videoFile: File | null = null;
  videoUrl = '';
  videoReady = false;
  isDragging = false;
  playing = false;
  currentTime = 0;
  duration = 0;
  processing = false;

  trimStart = 0;
  trimEnd = 0;

  cropEnabled = false;
  crop = { x: 0, y: 0, width: 0, height: 0 };

  videoWidth = 0;
  videoHeight = 0;
  displayRect: Rect = { left: 0, top: 0, width: 0, height: 0 };
  thumbnails: string[] = [];

  private animationId: number | null = null;
  private resizeObs?: ResizeObserver;

  readonly cropPresets = [
    { label: '16:9', r: 16 / 9 }, { label: '9:16', r: 9 / 16 }, { label: '1:1', r: 1 },
    { label: '4:3', r: 4 / 3 }, { label: '4:5', r: 4 / 5 }, { label: 'Full', r: 0 },
  ];

  get videoEl(): HTMLVideoElement { return this.videoElRef?.nativeElement; }
  get dispScale(): number { return this.videoWidth ? this.displayRect.width / this.videoWidth : 1; }
  get cropBox(): Rect {
    const s = this.dispScale;
    return {
      left: this.displayRect.left + this.crop.x * s, top: this.displayRect.top + this.crop.y * s,
      width: this.crop.width * s, height: this.crop.height * s,
    };
  }
  pct(t: number): number { return this.duration ? Math.max(0, Math.min(100, (t / this.duration) * 100)) : 0; }

  ngAfterViewInit() {
    const id = this.route.snapshot.paramMap.get('id');
    // Navigation state must be read from history.state — getCurrentNavigation() is null after nav.
    const stateFile = (window.history.state && window.history.state.file) as File | undefined;
    if (stateFile) {
      this.loadFile(stateFile);
    } else if (id) {
      this.jobService.get(id).subscribe({
        next: (res) => {
          const job = res.job;
          this.videoUrl = this.getVideoUrl(job.inputPath, 'uploads');
          const e = job.pipeline?.editor;
          if (e?.trim?.enabled) { this.trimStart = e.trim.start; this.trimEnd = e.trim.end; }
          if (e?.crop?.enabled && e.crop.width) { this.cropEnabled = true; this.crop = { ...e.crop }; }
          this.cdr.detectChanges();
        },
      });
    }
  }

  ngOnDestroy() {
    if (this.videoUrl?.startsWith('blob:')) URL.revokeObjectURL(this.videoUrl);
    if (this.animationId) cancelAnimationFrame(this.animationId);
    this.resizeObs?.disconnect();
  }

  onDragOver(e: DragEvent) { e.preventDefault(); this.isDragging = true; }
  onDrop(e: DragEvent) {
    e.preventDefault(); this.isDragging = false;
    const f = e.dataTransfer?.files[0];
    if (f && f.type.startsWith('video/')) this.loadFile(f);
  }
  onFileSelected(e: any) { const f = e.target.files?.[0]; if (f) this.loadFile(f); }

  private loadFile(file: File) {
    this.videoFile = file;
    this.videoReady = false;
    this.cropEnabled = false;
    this.thumbnails = [];
    this.videoUrl = URL.createObjectURL(file);
    this.cdr.detectChanges();
  }

  onVideoLoaded() {
    const v = this.videoEl;
    this.videoReady = true;
    this.duration = v.duration || 0;
    this.trimStart = 0;
    this.trimEnd = this.duration;
    this.videoWidth = v.videoWidth || 1280;
    this.videoHeight = v.videoHeight || 720;
    this.computeDisplayRect();
    this.initCrop();
    if (!this.resizeObs && this.containerRef) {
      this.resizeObs = new ResizeObserver(() => { this.computeDisplayRect(); this.cdr.detectChanges(); });
      this.resizeObs.observe(this.containerRef.nativeElement);
    }
    this.generateThumbnails();
    this.cdr.detectChanges();
  }

  private computeDisplayRect() {
    const c = this.containerRef?.nativeElement;
    if (!c || !this.videoWidth) return;
    const cw = c.clientWidth, ch = c.clientHeight;
    const va = this.videoWidth / this.videoHeight;
    let w: number, h: number;
    if (cw / ch > va) { h = ch; w = h * va; } else { w = cw; h = w / va; }
    this.displayRect = { left: (cw - w) / 2, top: (ch - h) / 2, width: w, height: h };
  }

  private initCrop() {
    this.crop = {
      x: Math.round(this.videoWidth * 0.1), y: Math.round(this.videoHeight * 0.1),
      width: Math.round(this.videoWidth * 0.8), height: Math.round(this.videoHeight * 0.8),
    };
  }

  private async generateThumbnails(count = 12) {
    const url = this.videoUrl;
    const v = document.createElement('video');
    v.src = url; v.muted = true; v.preload = 'auto'; (v as any).playsInline = true;
    try { await new Promise((res, rej) => { v.onloadeddata = () => res(null); v.onerror = () => rej(); setTimeout(rej, 8000); }); }
    catch { return; }
    const dur = v.duration || this.duration;
    if (!isFinite(dur) || dur <= 0) return;
    const tw = 160, th = Math.max(40, Math.round(tw * (this.videoHeight / this.videoWidth)) || 90);
    const canvas = document.createElement('canvas');
    canvas.width = tw; canvas.height = th;
    const ctx = canvas.getContext('2d');
    const out: string[] = [];
    for (let i = 0; i < count; i++) {
      const t = Math.min(dur - 0.05, ((i + 0.5) / count) * dur);
      try {
        await new Promise((res, rej) => { v.onseeked = () => res(null); setTimeout(rej, 4000); v.currentTime = t; });
        ctx!.drawImage(v, 0, 0, tw, th);
        out.push(canvas.toDataURL('image/jpeg', 0.6));
      } catch { out.push(''); }
    }
    this.zone.run(() => { this.thumbnails = out; this.cdr.detectChanges(); });
  }

  onTimeUpdate() { this.currentTime = this.videoEl?.currentTime || 0; }

  togglePlay() {
    const v = this.videoEl; if (!v) return;
    if (v.paused) { v.play().catch(() => {}); this.startLoop(); } else { v.pause(); }
  }
  private startLoop() {
    const loop = () => {
      if (this.videoEl && !this.videoEl.paused) {
        this.currentTime = this.videoEl.currentTime;
        // pause playback at the trim out-point
        if (this.currentTime >= this.trimEnd) { this.videoEl.pause(); this.videoEl.currentTime = this.trimEnd; }
        this.animationId = requestAnimationFrame(loop);
      }
    };
    this.animationId = requestAnimationFrame(loop);
  }
  seekTo(t: number) { if (this.videoEl) { this.videoEl.currentTime = Math.max(0, Math.min(t, this.duration)); this.currentTime = this.videoEl.currentTime; } }

  formatTime(s: number): string {
    if (!s || !isFinite(s)) return '0:00.0';
    const m = Math.floor(s / 60), sec = (s % 60);
    return `${m}:${sec.toFixed(1).padStart(4, '0')}`;
  }

  // ── Timeline / trim ──
  private timeAtClientX(clientX: number): number {
    const r = this.timelineRef.nativeElement.getBoundingClientRect();
    return Math.max(0, Math.min(1, (clientX - r.left) / r.width)) * this.duration;
  }
  onTimelineClick(e: MouseEvent) {
    if ((e.target as HTMLElement).classList.contains('tl-handle')) return;
    this.seekTo(this.timeAtClientX(e.clientX));
  }
  onTrimDown(e: MouseEvent, which: 'start' | 'end') {
    e.preventDefault(); e.stopPropagation();
    const move = (ev: MouseEvent) => {
      const t = this.timeAtClientX(ev.clientX);
      if (which === 'start') this.trimStart = Math.min(t, this.trimEnd - 0.1);
      else this.trimEnd = Math.max(t, this.trimStart + 0.1);
      this.trimStart = Math.max(0, this.trimStart); this.trimEnd = Math.min(this.duration, this.trimEnd);
      this.seekTo(which === 'start' ? this.trimStart : this.trimEnd);
      this.cdr.detectChanges();
    };
    const up = () => { document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', up); };
    document.addEventListener('mousemove', move); document.addEventListener('mouseup', up);
  }
  clampTrim() {
    this.trimStart = Math.max(0, Math.min(+this.trimStart || 0, this.duration));
    this.trimEnd = Math.max(this.trimStart + 0.1, Math.min(+this.trimEnd || this.duration, this.duration));
  }
  setIn() { this.trimStart = Math.min(this.currentTime, this.trimEnd - 0.1); }
  setOut() { this.trimEnd = Math.max(this.currentTime, this.trimStart + 0.1); }
  resetTrim() { this.trimStart = 0; this.trimEnd = this.duration; }

  // ── Crop ──
  onCropToggle() { if (this.cropEnabled) this.initCrop(); }
  applyCropPreset(p: { label: string; r: number }) {
    this.cropEnabled = true;
    if (p.r === 0) { this.crop = { x: 0, y: 0, width: this.videoWidth, height: this.videoHeight }; return; }
    const srcR = this.videoWidth / this.videoHeight;
    let w: number, h: number;
    if (srcR > p.r) { h = this.videoHeight; w = h * p.r; } else { w = this.videoWidth; h = w / p.r; }
    this.crop = { x: Math.round((this.videoWidth - w) / 2), y: Math.round((this.videoHeight - h) / 2), width: Math.round(w), height: Math.round(h) };
  }
  clampCrop() {
    this.crop.x = Math.max(0, Math.min(+this.crop.x || 0, this.videoWidth - 2));
    this.crop.y = Math.max(0, Math.min(+this.crop.y || 0, this.videoHeight - 2));
    this.crop.width = Math.max(2, Math.min(+this.crop.width || 2, this.videoWidth - this.crop.x));
    this.crop.height = Math.max(2, Math.min(+this.crop.height || 2, this.videoHeight - this.crop.y));
  }
  resetCrop() { this.crop = { x: 0, y: 0, width: this.videoWidth, height: this.videoHeight }; }

  onCropMoveStart(e: MouseEvent) {
    e.preventDefault();
    const start = { x: e.clientX, y: e.clientY, cx: this.crop.x, cy: this.crop.y };
    const s = this.dispScale;
    const move = (ev: MouseEvent) => {
      const dx = Math.round((ev.clientX - start.x) / s), dy = Math.round((ev.clientY - start.y) / s);
      this.crop.x = Math.max(0, Math.min(start.cx + dx, this.videoWidth - this.crop.width));
      this.crop.y = Math.max(0, Math.min(start.cy + dy, this.videoHeight - this.crop.height));
      this.cdr.detectChanges();
    };
    const up = () => { document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', up); };
    document.addEventListener('mousemove', move); document.addEventListener('mouseup', up);
  }
  onCropResizeStart(e: MouseEvent, corner: string) {
    e.preventDefault(); e.stopPropagation();
    const r = { x: e.clientX, y: e.clientY, cx: this.crop.x, cy: this.crop.y, cw: this.crop.width, ch: this.crop.height };
    const s = this.dispScale;
    const move = (ev: MouseEvent) => {
      const dx = Math.round((ev.clientX - r.x) / s), dy = Math.round((ev.clientY - r.y) / s);
      let { cx: nx, cy: ny, cw: nw, ch: nh } = r;
      if (corner.includes('r')) nw = r.cw + dx;
      if (corner.includes('l')) { nx = r.cx + dx; nw = r.cw - dx; }
      if (corner.includes('b')) nh = r.ch + dy;
      if (corner.includes('t')) { ny = r.cy + dy; nh = r.ch - dy; }
      if (nw < 20) { nw = 20; if (corner.includes('l')) nx = r.cx + r.cw - 20; }
      if (nh < 20) { nh = 20; if (corner.includes('t')) ny = r.cy + r.ch - 20; }
      nx = Math.max(0, nx); ny = Math.max(0, ny);
      if (nx + nw > this.videoWidth) nw = this.videoWidth - nx;
      if (ny + nh > this.videoHeight) nh = this.videoHeight - ny;
      this.crop = { x: nx, y: ny, width: nw, height: nh };
      this.cdr.detectChanges();
    };
    const up = () => { document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', up); };
    document.addEventListener('mousemove', move); document.addEventListener('mouseup', up);
  }

  getVideoUrl(p: string, type: string): string {
    const idx = p.indexOf(`\\${type}\\`);
    if (idx !== -1) return p.slice(idx).replace(/\\/g, '/');
    const idx2 = p.indexOf(`/${type}/`);
    if (idx2 !== -1) return p.slice(idx2);
    const filename = p.split('\\').pop() || p.split('/').pop();
    return `/${type}/${filename}`;
  }

  goBack() { this.router.navigate(['/dashboard']); }

  async applyAndExport() {
    if (this.processing || !this.videoUrl) return;
    this.processing = true;
    const doTrim = this.trimStart > 0.05 || this.trimEnd < this.duration - 0.05;
    const doCrop = this.cropEnabled && this.crop.width > 0 && this.crop.height > 0 &&
      (this.crop.width < this.videoWidth || this.crop.height < this.videoHeight);
    const editorSettings = {
      editor: {
        trim: { enabled: doTrim, start: this.trimStart, end: this.trimEnd },
        crop: { enabled: doCrop, x: this.crop.x, y: this.crop.y, width: this.crop.width, height: this.crop.height },
      },
    };
    try {
      if (this.videoFile) {
        const res = await firstValueFrom(this.jobService.create(
          this.videoFile.name.replace(/\.[^/.]+$/, ''), { pipeline: editorSettings }, this.videoFile, 'edit'));
        if (res?.job?._id) { this.router.navigate(['/processing', res.job._id]); return; }
      }
      const id = this.route.snapshot.paramMap.get('id');
      if (id) { await firstValueFrom(this.jobService.updatePipeline(id, editorSettings)); this.router.navigate(['/processing', id]); }
    } catch (err) {
      console.error('Failed to export edited clip:', err);
      this.processing = false;
    }
  }
}
