import { Component, inject, ElementRef, ViewChild, OnDestroy, ChangeDetectorRef, NgZone } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { JobService } from '../core/job.service';

interface Rect { left: number; top: number; width: number; height: number; }

@Component({
  selector: 'app-studio',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
  <div class="studio" [class.empty]="!videoUrl">
    <!-- Top bar -->
    <header class="topbar">
      <div class="brand"><span class="logo">CineRemaster</span><span class="badge">Studio</span></div>
      <div class="project">{{ videoFile?.name || 'New Project' }}</div>
      <div class="top-actions">
        <button class="btn-ghost" (click)="goBack()">Exit</button>
        <button class="btn-export" (click)="exportProject()" [disabled]="processing || !videoUrl">
          {{ processing ? 'Exporting…' : 'Export ▾' }}
        </button>
      </div>
    </header>

    <div class="body">
      <!-- Icon sidebar -->
      <nav class="sidebar">
        <button class="nav" *ngFor="let s of panels" [class.active]="active === s.key" (click)="active = s.key">
          <span class="ic">{{ s.icon }}</span><span class="lbl">{{ s.label }}</span>
        </button>
      </nav>

      <!-- Center: preview -->
      <main class="center">
        <div class="preview-wrap">
          <div *ngIf="!videoUrl" class="dropzone" (dragover)="onDragOver($event)" (dragleave)="dragging=false" (drop)="onDrop($event)" [class.dragging]="dragging">
            <div class="ic">🎬</div>
            <h3>Drop a video to start</h3>
            <p>Trim, crop, enhance, clean audio and auto-subtitle — all in one place.</p>
            <input #fileInput type="file" accept="video/*" hidden (change)="onFileSelected($event)" />
            <button class="btn-primary" (click)="fileInput.click()">Upload Video</button>
          </div>

          <div *ngIf="videoUrl" class="video-container" #videoContainer>
            <video #videoEl [src]="videoUrl" preload="auto" playsinline
              (loadedmetadata)="onVideoLoaded()" (timeupdate)="onTimeUpdate()"
              (play)="playing=true" (pause)="playing=false" (click)="togglePlay()"></video>
            <ng-container *ngIf="active==='crop' && crop.enabled && videoReady">
              <div class="crop-mask" [style.left.px]="cropBox.left" [style.top.px]="cropBox.top" [style.width.px]="cropBox.width" [style.height.px]="cropBox.height"></div>
              <div class="crop-box" [style.left.px]="cropBox.left" [style.top.px]="cropBox.top" [style.width.px]="cropBox.width" [style.height.px]="cropBox.height" (mousedown)="onCropMoveStart($event)">
                <div class="gv"></div><div class="gh"></div>
                <div class="hd tl" (mousedown)="onCropResize($event,'tl')"></div><div class="hd tr" (mousedown)="onCropResize($event,'tr')"></div>
                <div class="hd bl" (mousedown)="onCropResize($event,'bl')"></div><div class="hd br" (mousedown)="onCropResize($event,'br')"></div>
                <span class="dim">{{ crop.width }}×{{ crop.height }}</span>
              </div>
            </ng-container>
          </div>
        </div>

        <div class="transport" *ngIf="videoUrl">
          <button class="t-btn" (click)="seekTo(trimStart)">⏮</button>
          <button class="t-btn play" (click)="togglePlay()">{{ playing ? '⏸' : '▶' }}</button>
          <span class="tc">{{ formatTime(currentTime) }} / {{ formatTime(duration) }}</span>
          <span class="ar">{{ videoWidth }}×{{ videoHeight }}</span>
        </div>

        <!-- Timeline -->
        <div class="timeline-wrap" *ngIf="videoUrl">
          <div class="track-label">Video</div>
          <div class="timeline" #timeline (mousedown)="onTimelineClick($event)">
            <div class="filmstrip"><div class="th" *ngFor="let t of thumbnails" [style.background-image]="t ? 'url('+t+')' : null"></div>
              <div class="th ph" *ngIf="!thumbnails.length">loading frames…</div></div>
            <div class="dim" [style.left.px]="0" [style.width.%]="pct(trimStart)"></div>
            <div class="dim" [style.left.%]="pct(trimEnd)" [style.right.px]="0"></div>
            <div class="sel" [style.left.%]="pct(trimStart)" [style.width.%]="pct(trimEnd)-pct(trimStart)"></div>
            <div class="handle" [style.left.%]="pct(trimStart)" (mousedown)="onTrimDown($event,'start')"></div>
            <div class="handle" [style.left.%]="pct(trimEnd)" (mousedown)="onTrimDown($event,'end')"></div>
            <div class="playhead" [style.left.%]="pct(currentTime)"></div>
          </div>
          <div class="track-label sub" *ngIf="subs.enabled">Subtitle</div>
          <div class="sub-track" *ngIf="subs.enabled"><div class="sub-note">Auto-generated on export · {{ subs.output }}</div></div>
        </div>
      </main>

      <!-- Right properties -->
      <aside class="props" *ngIf="videoUrl">
        <!-- MEDIA -->
        <div *ngIf="active==='media'">
          <h4>Media</h4>
          <div class="filecard"><span class="fi">🎬</span><div><div class="fn">{{ videoFile?.name || 'Source video' }}</div><div class="fm">{{ videoWidth }}×{{ videoHeight }} · {{ formatTime(duration) }}</div></div></div>
          <input #replace type="file" accept="video/*" hidden (change)="onFileSelected($event)" />
          <button class="btn-ghost full" (click)="replace.click()">Replace video</button>
        </div>
        <!-- TRIM -->
        <div *ngIf="active==='trim'">
          <h4>✂ Trim</h4>
          <p class="hint">Drag the handles on the timeline, or set exact times.</p>
          <div class="row2"><label>In<input type="number" min="0" step="0.1" [(ngModel)]="trimStart" (change)="clampTrim()"/></label><label>Out<input type="number" step="0.1" [(ngModel)]="trimEnd" (change)="clampTrim()"/></label></div>
          <div class="chips"><button (click)="trimStart=currentTime; clampTrim()">Set In</button><button (click)="trimEnd=currentTime; clampTrim()">Set Out</button><button (click)="resetTrim()">Reset</button></div>
          <div class="meta">Selection: {{ formatTime(trimEnd-trimStart) }}</div>
        </div>
        <!-- CROP -->
        <div *ngIf="active==='crop'">
          <h4>📐 Crop <label class="sw"><input type="checkbox" [(ngModel)]="crop.enabled" (change)="onCropToggle()"/><span></span></label></h4>
          <ng-container *ngIf="crop.enabled">
            <p class="hint">Drag the box on the video, or pick a ratio.</p>
            <div class="chips wrap"><button *ngFor="let r of ratios" (click)="applyRatio(r)">{{ r.label }}</button></div>
            <div class="row2"><label>X<input type="number" [(ngModel)]="crop.x" (change)="clampCrop()"/></label><label>Y<input type="number" [(ngModel)]="crop.y" (change)="clampCrop()"/></label>
              <label>W<input type="number" [(ngModel)]="crop.width" (change)="clampCrop()"/></label><label>H<input type="number" [(ngModel)]="crop.height" (change)="clampCrop()"/></label></div>
          </ng-container>
        </div>
        <!-- SUBTITLES -->
        <div *ngIf="active==='subtitles'">
          <h4>📝 Subtitles <label class="sw"><input type="checkbox" [(ngModel)]="subs.enabled"/><span></span></label></h4>
          <ng-container *ngIf="subs.enabled">
            <p class="hint">Auto-transcribed with Whisper and added to your video on export.</p>
            <label class="fld">Language<select [(ngModel)]="subs.language"><option value="auto">Auto-detect</option><option value="en">English</option><option value="kn">Kannada</option><option value="te">Telugu</option><option value="hi">Hindi</option><option value="ta">Tamil</option></select></label>
            <label class="fld">Accuracy<select [(ngModel)]="subs.model"><option value="tiny">Tiny — fastest</option><option value="base">Base</option><option value="small">Small — best</option></select></label>
            <label class="fld">Output<select [(ngModel)]="subs.output"><option value="burn">Burn into video</option><option value="embed">Embed as track</option><option value="srt">.srt file only</option></select></label>
          </ng-container>
        </div>
        <!-- AUDIO -->
        <div *ngIf="active==='audio'">
          <h4>🎵 Audio <label class="sw"><input type="checkbox" [(ngModel)]="audio.enabled"/><span></span></label></h4>
          <ng-container *ngIf="audio.enabled">
            <p class="hint">Removes hiss, hum and background noise.</p>
            <label class="fld">Noise reduction — {{ audio.strength }}<input type="range" min="0" max="1" step="0.1" [(ngModel)]="audio.strength"/></label>
          </ng-container>
        </div>
        <!-- ENHANCE -->
        <div *ngIf="active==='enhance'">
          <h4>✨ Enhance <label class="sw"><input type="checkbox" [(ngModel)]="enhance.enabled"/><span></span></label></h4>
          <ng-container *ngIf="enhance.enabled">
            <label class="fld">Target resolution<select [(ngModel)]="enhance.target"><option value="1080p">1080p</option><option value="2k">2K</option><option value="4k">4K</option><option value="8k">8K (slow on CPU)</option></select></label>
            <label class="fld">Color grade<select [(ngModel)]="enhance.color"><option value="">None</option><option value="cinematic">Cinematic</option><option value="teal_orange">Teal & Orange</option><option value="warm">Warm</option><option value="cool">Cool</option><option value="vintage">Vintage</option></select></label>
            <label class="chk"><input type="checkbox" [(ngModel)]="enhance.denoise"/> Denoise / sharpen</label>
          </ng-container>
        </div>
        <!-- EXPORT -->
        <div *ngIf="active==='export'">
          <h4>⬇ Export</h4>
          <div class="summary">
            <div [class.on]="hasTrim">✂ Trim {{ hasTrim ? formatTime(trimEnd-trimStart) : 'off' }}</div>
            <div [class.on]="crop.enabled">📐 Crop {{ crop.enabled ? crop.width+'×'+crop.height : 'off' }}</div>
            <div [class.on]="enhance.enabled">✨ Enhance {{ enhance.enabled ? enhance.target : 'off' }}</div>
            <div [class.on]="audio.enabled">🎵 Audio cleanup {{ audio.enabled ? 'on' : 'off' }}</div>
            <div [class.on]="subs.enabled">📝 Subtitles {{ subs.enabled ? subs.output : 'off' }}</div>
          </div>
          <button class="btn-primary full" (click)="exportProject()" [disabled]="processing">{{ processing ? 'Exporting…' : 'Export Video' }}</button>
          <p class="hint" *ngIf="enhance.enabled && enhance.target==='8k'">8K renders slowly without a GPU.</p>
        </div>
      </aside>
    </div>
  </div>
  `,
  styles: [`
    :host { --bg:#0F1117; --card:#181C25; --bd:#2A2F3A; --acc:#3B82F6; --h:#fff; --b:#D1D5DB; --m:#9CA3AF; }
    .studio { height: 100vh; display: flex; flex-direction: column; background: var(--bg); color: var(--b); font-size: 13px; }
    .topbar { display: flex; align-items: center; gap: 16px; padding: 10px 16px; border-bottom: 1px solid var(--bd); background: var(--card); }
    .brand { display: flex; align-items: center; gap: 8px; }
    .logo { font-weight: 800; color: var(--h); }
    .badge { font-size: 10px; padding: 2px 8px; background: rgba(59,130,246,.15); color: var(--acc); border-radius: 6px; }
    .project { flex: 1; text-align: center; color: var(--m); }
    .top-actions { display: flex; gap: 8px; }
    .btn-ghost { background: transparent; border: 1px solid var(--bd); color: var(--b); padding: 8px 14px; border-radius: 10px; cursor: pointer; }
    .btn-ghost.full { width: 100%; margin-top: 10px; }
    .btn-export { background: var(--acc); border: none; color: #fff; padding: 8px 18px; border-radius: 10px; font-weight: 600; cursor: pointer; }
    .btn-export:disabled { opacity: .5; cursor: not-allowed; }
    .btn-primary { background: var(--acc); border: none; color: #fff; padding: 12px 22px; border-radius: 10px; font-weight: 600; cursor: pointer; }
    .btn-primary.full { width: 100%; }
    .btn-primary:disabled { opacity: .5; }

    .body { flex: 1; display: grid; grid-template-columns: 84px 1fr 300px; min-height: 0; }
    .sidebar { background: var(--card); border-right: 1px solid var(--bd); padding: 10px 6px; display: flex; flex-direction: column; gap: 4px; overflow: auto; }
    .nav { display: flex; flex-direction: column; align-items: center; gap: 3px; background: transparent; border: none; color: var(--m); padding: 10px 4px; border-radius: 10px; cursor: pointer; }
    .nav .ic { font-size: 18px; }
    .nav .lbl { font-size: 10px; }
    .nav:hover { background: rgba(255,255,255,.04); color: var(--b); }
    .nav.active { background: rgba(59,130,246,.15); color: var(--acc); }

    .center { display: flex; flex-direction: column; min-width: 0; padding: 16px; gap: 12px; }
    .preview-wrap { flex: 1; min-height: 0; display: flex; align-items: center; justify-content: center; }
    .video-container { position: relative; width: 100%; height: 100%; background: #000; border-radius: 12px; overflow: hidden; border: 1px solid var(--bd); }
    .video-container video { width: 100%; height: 100%; object-fit: contain; display: block; cursor: pointer; }
    .dropzone { width: 100%; max-width: 560px; text-align: center; border: 2px dashed var(--bd); border-radius: 16px; padding: 56px 24px; }
    .dropzone.dragging { border-color: var(--acc); background: rgba(59,130,246,.06); }
    .dropzone .ic { font-size: 44px; margin-bottom: 12px; }
    .dropzone h3 { color: var(--h); font-size: 18px; margin-bottom: 8px; }
    .dropzone p { color: var(--m); margin-bottom: 18px; }

    .crop-mask { position: absolute; box-shadow: 0 0 0 9999px rgba(0,0,0,.6); pointer-events: none; z-index: 5; }
    .crop-box { position: absolute; border: 1px solid #fff; box-sizing: border-box; cursor: move; z-index: 6; }
    .crop-box .gv { position: absolute; left: 33.3%; right: 33.3%; top: 0; bottom: 0; border-left: 1px solid rgba(255,255,255,.3); border-right: 1px solid rgba(255,255,255,.3); }
    .crop-box .gh { position: absolute; top: 33.3%; bottom: 33.3%; left: 0; right: 0; border-top: 1px solid rgba(255,255,255,.3); border-bottom: 1px solid rgba(255,255,255,.3); }
    .crop-box .hd { position: absolute; width: 12px; height: 12px; background: var(--acc); border: 2px solid #fff; border-radius: 2px; }
    .crop-box .hd.tl{top:-6px;left:-6px;cursor:nwse-resize}.crop-box .hd.tr{top:-6px;right:-6px;cursor:nesw-resize}.crop-box .hd.bl{bottom:-6px;left:-6px;cursor:nesw-resize}.crop-box .hd.br{bottom:-6px;right:-6px;cursor:nwse-resize}
    .crop-box .dim { position: absolute; bottom: 4px; left: 50%; transform: translateX(-50%); font-size: 11px; background: rgba(0,0,0,.7); padding: 2px 6px; border-radius: 3px; }

    .transport { display: flex; align-items: center; gap: 12px; }
    .t-btn { width: 36px; height: 36px; border-radius: 8px; border: none; background: var(--card); color: #fff; cursor: pointer; }
    .t-btn.play { background: var(--acc); }
    .tc { color: var(--m); } .ar { margin-left: auto; color: var(--m); }

    .timeline-wrap { background: var(--card); border: 1px solid var(--bd); border-radius: 12px; padding: 10px; }
    .track-label { font-size: 11px; color: var(--m); margin-bottom: 4px; }
    .track-label.sub { margin-top: 8px; }
    .timeline { position: relative; height: 60px; border-radius: 8px; overflow: hidden; background: #0b0d12; cursor: pointer; user-select: none; }
    .filmstrip { position: absolute; inset: 0; display: flex; }
    .filmstrip .th { flex: 1; background-size: cover; background-position: center; border-right: 1px solid rgba(0,0,0,.4); }
    .filmstrip .ph { display: flex; align-items: center; justify-content: center; color: #555; font-size: 11px; }
    .timeline .dim { position: absolute; top: 0; bottom: 0; background: rgba(15,17,23,.7); pointer-events: none; }
    .timeline .sel { position: absolute; top: 0; bottom: 0; border: 2px solid var(--acc); box-sizing: border-box; pointer-events: none; }
    .timeline .handle { position: absolute; top: 0; bottom: 0; width: 12px; margin-left: -6px; background: var(--acc); border-radius: 3px; cursor: ew-resize; z-index: 3; }
    .timeline .playhead { position: absolute; top: 0; bottom: 0; width: 2px; margin-left: -1px; background: #fff; z-index: 4; pointer-events: none; }
    .sub-track { height: 26px; background: #0b0d12; border-radius: 6px; display: flex; align-items: center; padding: 0 10px; }
    .sub-note { font-size: 11px; color: var(--acc); }

    .props { background: var(--card); border-left: 1px solid var(--bd); padding: 16px; overflow: auto; }
    .props h4 { color: var(--h); font-size: 14px; margin-bottom: 12px; display: flex; align-items: center; justify-content: space-between; }
    .hint { color: var(--m); font-size: 12px; line-height: 1.4; margin: 0 0 12px; }
    .filecard { display: flex; gap: 10px; align-items: center; background: var(--bg); border: 1px solid var(--bd); border-radius: 10px; padding: 12px; }
    .filecard .fi { font-size: 22px; } .fn { color: var(--h); font-size: 13px; } .fm { color: var(--m); font-size: 11px; }
    .row2 { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-bottom: 10px; }
    .row2 label, .fld { display: flex; flex-direction: column; gap: 4px; font-size: 11px; color: var(--m); margin-bottom: 10px; }
    input[type=number], select { background: var(--bg); border: 1px solid var(--bd); border-radius: 8px; padding: 8px; color: var(--h); outline: none; }
    input[type=number]:focus, select:focus { border-color: var(--acc); }
    input[type=range] { accent-color: var(--acc); }
    .chips { display: flex; gap: 6px; margin-bottom: 10px; } .chips.wrap { flex-wrap: wrap; }
    .chips button { background: var(--bg); border: 1px solid var(--bd); color: var(--b); border-radius: 8px; padding: 6px 10px; font-size: 11px; cursor: pointer; }
    .chips button:hover { border-color: var(--acc); color: #fff; }
    .meta { color: var(--acc); font-size: 12px; }
    .chk { display: flex; align-items: center; gap: 8px; color: var(--b); cursor: pointer; }
    .sw { position: relative; width: 38px; height: 20px; }
    .sw input { display: none; }
    .sw span { position: absolute; inset: 0; background: var(--bd); border-radius: 20px; transition: .2s; }
    .sw span::before { content:''; position: absolute; left: 3px; top: 3px; width: 14px; height: 14px; background: #fff; border-radius: 50%; transition: .2s; }
    .sw input:checked + span { background: var(--acc); }
    .sw input:checked + span::before { transform: translateX(18px); }
    .summary { display: flex; flex-direction: column; gap: 6px; margin-bottom: 14px; }
    .summary div { color: var(--m); font-size: 12px; padding: 8px 10px; background: var(--bg); border: 1px solid var(--bd); border-radius: 8px; }
    .summary div.on { color: var(--h); border-color: var(--acc); }
  `],
})
export class StudioComponent implements OnDestroy {
  private router = inject(Router);
  private jobService = inject(JobService);
  private cdr = inject(ChangeDetectorRef);
  private zone = inject(NgZone);

  @ViewChild('videoEl') videoElRef!: ElementRef<HTMLVideoElement>;
  @ViewChild('videoContainer') containerRef!: ElementRef<HTMLDivElement>;
  @ViewChild('timeline') timelineRef!: ElementRef<HTMLDivElement>;

  readonly panels = [
    { key: 'media', icon: '🎬', label: 'Media' }, { key: 'trim', icon: '✂', label: 'Trim' },
    { key: 'crop', icon: '📐', label: 'Crop' }, { key: 'subtitles', icon: '📝', label: 'Subtitle' },
    { key: 'audio', icon: '🎵', label: 'Audio' }, { key: 'enhance', icon: '✨', label: 'Enhance' },
    { key: 'export', icon: '⬇', label: 'Export' },
  ];
  readonly ratios = [{ label: 'Free', r: 0 }, { label: '16:9', r: 16 / 9 }, { label: '9:16', r: 9 / 16 }, { label: '1:1', r: 1 }, { label: '4:5', r: 4 / 5 }, { label: '4:3', r: 4 / 3 }];

  active = 'media';
  videoFile: File | null = null;
  videoUrl = '';
  videoReady = false;
  dragging = false;
  playing = false;
  processing = false;
  currentTime = 0;
  duration = 0;
  trimStart = 0;
  trimEnd = 0;
  crop = { enabled: false, x: 0, y: 0, width: 0, height: 0 };
  enhance = { enabled: true, target: '1080p', color: 'cinematic', denoise: true };
  audio = { enabled: false, strength: 0.6 };
  subs = { enabled: false, language: 'auto', model: 'tiny', output: 'burn' };

  videoWidth = 0; videoHeight = 0;
  displayRect: Rect = { left: 0, top: 0, width: 0, height: 0 };
  thumbnails: string[] = [];
  private raf: number | null = null;
  private resizeObs?: ResizeObserver;

  get videoEl() { return this.videoElRef?.nativeElement; }
  get dispScale() { return this.videoWidth ? this.displayRect.width / this.videoWidth : 1; }
  get cropBox(): Rect {
    const s = this.dispScale;
    return { left: this.displayRect.left + this.crop.x * s, top: this.displayRect.top + this.crop.y * s, width: this.crop.width * s, height: this.crop.height * s };
  }
  pct(t: number) { return this.duration ? Math.max(0, Math.min(100, (t / this.duration) * 100)) : 0; }
  get hasTrim() { return this.trimStart > 0.05 || this.trimEnd < this.duration - 0.05; }

  ngOnDestroy() {
    if (this.videoUrl?.startsWith('blob:')) URL.revokeObjectURL(this.videoUrl);
    if (this.raf) cancelAnimationFrame(this.raf);
    this.resizeObs?.disconnect();
  }

  onDragOver(e: DragEvent) { e.preventDefault(); this.dragging = true; }
  onDrop(e: DragEvent) { e.preventDefault(); this.dragging = false; const f = e.dataTransfer?.files[0]; if (f?.type.startsWith('video/')) this.load(f); }
  onFileSelected(e: any) { const f = e.target.files?.[0]; if (f) this.load(f); }
  private load(f: File) {
    this.videoFile = f; this.videoReady = false; this.thumbnails = [];
    this.crop = { enabled: false, x: 0, y: 0, width: 0, height: 0 };
    if (this.videoUrl?.startsWith('blob:')) URL.revokeObjectURL(this.videoUrl);
    this.videoUrl = URL.createObjectURL(f);
    this.active = 'trim';
    this.cdr.detectChanges();
  }

  onVideoLoaded() {
    const v = this.videoEl;
    this.videoReady = true;
    this.duration = v.duration || 0; this.trimStart = 0; this.trimEnd = this.duration;
    this.videoWidth = v.videoWidth || 1280; this.videoHeight = v.videoHeight || 720;
    this.computeRect(); this.initCrop();
    if (!this.resizeObs && this.containerRef) {
      this.resizeObs = new ResizeObserver(() => { this.computeRect(); this.cdr.detectChanges(); });
      this.resizeObs.observe(this.containerRef.nativeElement);
    }
    this.makeThumbs(); this.cdr.detectChanges();
  }
  private computeRect() {
    const c = this.containerRef?.nativeElement; if (!c || !this.videoWidth) return;
    const cw = c.clientWidth, ch = c.clientHeight, va = this.videoWidth / this.videoHeight;
    let w: number, h: number; if (cw / ch > va) { h = ch; w = h * va; } else { w = cw; h = w / va; }
    this.displayRect = { left: (cw - w) / 2, top: (ch - h) / 2, width: w, height: h };
  }
  private initCrop() {
    this.crop = { ...this.crop, x: Math.round(this.videoWidth * 0.1), y: Math.round(this.videoHeight * 0.1), width: Math.round(this.videoWidth * 0.8), height: Math.round(this.videoHeight * 0.8) };
  }
  private async makeThumbs(n = 12) {
    const v = document.createElement('video'); v.src = this.videoUrl; v.muted = true; (v as any).playsInline = true;
    try { await new Promise((res, rej) => { v.onloadeddata = () => res(null); v.onerror = rej; setTimeout(rej, 8000); }); } catch { return; }
    const dur = v.duration || this.duration; if (!isFinite(dur) || dur <= 0) return;
    const tw = 160, th = Math.max(40, Math.round(tw * (this.videoHeight / this.videoWidth)) || 90);
    const cv = document.createElement('canvas'); cv.width = tw; cv.height = th; const ctx = cv.getContext('2d'); const out: string[] = [];
    for (let i = 0; i < n; i++) {
      try { await new Promise((res, rej) => { v.onseeked = () => res(null); setTimeout(rej, 4000); v.currentTime = Math.min(dur - 0.05, (i + 0.5) / n * dur); }); ctx!.drawImage(v, 0, 0, tw, th); out.push(cv.toDataURL('image/jpeg', 0.6)); } catch { out.push(''); }
    }
    this.zone.run(() => { this.thumbnails = out; this.cdr.detectChanges(); });
  }

  onTimeUpdate() { this.currentTime = this.videoEl?.currentTime || 0; }
  togglePlay() { const v = this.videoEl; if (!v) return; if (v.paused) { v.play().catch(() => {}); this.loop(); } else v.pause(); }
  private loop() { const f = () => { if (this.videoEl && !this.videoEl.paused) { this.currentTime = this.videoEl.currentTime; if (this.currentTime >= this.trimEnd) { this.videoEl.pause(); this.seekTo(this.trimEnd); } this.raf = requestAnimationFrame(f); } }; this.raf = requestAnimationFrame(f); }
  seekTo(t: number) { if (this.videoEl) { this.videoEl.currentTime = Math.max(0, Math.min(t, this.duration)); this.currentTime = this.videoEl.currentTime; } }
  formatTime(s: number) { if (!s || !isFinite(s)) return '0:00.0'; const m = Math.floor(s / 60); return `${m}:${(s % 60).toFixed(1).padStart(4, '0')}`; }

  private tAtX(x: number) { const r = this.timelineRef.nativeElement.getBoundingClientRect(); return Math.max(0, Math.min(1, (x - r.left) / r.width)) * this.duration; }
  onTimelineClick(e: MouseEvent) { if ((e.target as HTMLElement).classList.contains('handle')) return; this.seekTo(this.tAtX(e.clientX)); }
  onTrimDown(e: MouseEvent, which: 'start' | 'end') {
    e.preventDefault(); e.stopPropagation();
    const move = (ev: MouseEvent) => {
      const t = this.tAtX(ev.clientX);
      if (which === 'start') this.trimStart = Math.max(0, Math.min(t, this.trimEnd - 0.1)); else this.trimEnd = Math.min(this.duration, Math.max(t, this.trimStart + 0.1));
      this.seekTo(which === 'start' ? this.trimStart : this.trimEnd); this.cdr.detectChanges();
    };
    const up = () => { document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', up); };
    document.addEventListener('mousemove', move); document.addEventListener('mouseup', up);
  }
  clampTrim() { this.trimStart = Math.max(0, Math.min(+this.trimStart || 0, this.duration)); this.trimEnd = Math.max(this.trimStart + 0.1, Math.min(+this.trimEnd || this.duration, this.duration)); }
  resetTrim() { this.trimStart = 0; this.trimEnd = this.duration; }

  onCropToggle() { if (this.crop.enabled) this.initCrop(); }
  applyRatio(rr: { label: string; r: number }) {
    this.crop.enabled = true;
    if (rr.r === 0) { this.crop = { ...this.crop, x: 0, y: 0, width: this.videoWidth, height: this.videoHeight }; return; }
    const sr = this.videoWidth / this.videoHeight; let w: number, h: number;
    if (sr > rr.r) { h = this.videoHeight; w = h * rr.r; } else { w = this.videoWidth; h = w / rr.r; }
    this.crop = { enabled: true, x: Math.round((this.videoWidth - w) / 2), y: Math.round((this.videoHeight - h) / 2), width: Math.round(w), height: Math.round(h) };
  }
  clampCrop() {
    this.crop.x = Math.max(0, Math.min(+this.crop.x || 0, this.videoWidth - 2)); this.crop.y = Math.max(0, Math.min(+this.crop.y || 0, this.videoHeight - 2));
    this.crop.width = Math.max(2, Math.min(+this.crop.width || 2, this.videoWidth - this.crop.x)); this.crop.height = Math.max(2, Math.min(+this.crop.height || 2, this.videoHeight - this.crop.y));
  }
  onCropMoveStart(e: MouseEvent) {
    e.preventDefault(); const s = this.dispScale; const st = { x: e.clientX, y: e.clientY, cx: this.crop.x, cy: this.crop.y };
    const move = (ev: MouseEvent) => {
      const dx = Math.round((ev.clientX - st.x) / s), dy = Math.round((ev.clientY - st.y) / s);
      this.crop.x = Math.max(0, Math.min(st.cx + dx, this.videoWidth - this.crop.width)); this.crop.y = Math.max(0, Math.min(st.cy + dy, this.videoHeight - this.crop.height)); this.cdr.detectChanges();
    };
    const up = () => { document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', up); };
    document.addEventListener('mousemove', move); document.addEventListener('mouseup', up);
  }
  onCropResize(e: MouseEvent, c: string) {
    e.preventDefault(); e.stopPropagation(); const s = this.dispScale; const r = { x: e.clientX, y: e.clientY, cx: this.crop.x, cy: this.crop.y, cw: this.crop.width, ch: this.crop.height };
    const move = (ev: MouseEvent) => {
      const dx = Math.round((ev.clientX - r.x) / s), dy = Math.round((ev.clientY - r.y) / s); let { cx: nx, cy: ny, cw: nw, ch: nh } = r;
      if (c.includes('r')) nw = r.cw + dx; if (c.includes('l')) { nx = r.cx + dx; nw = r.cw - dx; }
      if (c.includes('b')) nh = r.ch + dy; if (c.includes('t')) { ny = r.cy + dy; nh = r.ch - dy; }
      if (nw < 20) { nw = 20; if (c.includes('l')) nx = r.cx + r.cw - 20; } if (nh < 20) { nh = 20; if (c.includes('t')) ny = r.cy + r.ch - 20; }
      nx = Math.max(0, nx); ny = Math.max(0, ny); if (nx + nw > this.videoWidth) nw = this.videoWidth - nx; if (ny + nh > this.videoHeight) nh = this.videoHeight - ny;
      this.crop = { enabled: true, x: nx, y: ny, width: nw, height: nh }; this.cdr.detectChanges();
    };
    const up = () => { document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', up); };
    document.addEventListener('mousemove', move); document.addEventListener('mouseup', up);
  }

  goBack() { this.router.navigate(['/dashboard']); }

  async exportProject() {
    if (this.processing || !this.videoFile) return;
    this.processing = true;
    const doTrim = this.trimStart > 0.05 || this.trimEnd < this.duration - 0.05;
    const doCrop = this.crop.enabled && this.crop.width > 0 && (this.crop.width < this.videoWidth || this.crop.height < this.videoHeight);
    const pipeline = {
      editor: {
        trim: { enabled: doTrim, start: this.trimStart, end: this.trimEnd },
        crop: { enabled: doCrop, x: this.crop.x, y: this.crop.y, width: this.crop.width, height: this.crop.height },
      },
      enhance: { enabled: this.enhance.enabled, target: this.enhance.target, color: this.enhance.color, denoise: this.enhance.denoise },
      audioCleanup: { enabled: this.audio.enabled, strength: this.audio.strength },
      subtitles: { enabled: this.subs.enabled, language: this.subs.language, model: this.subs.model, output: this.subs.output },
    };
    try {
      const res = await firstValueFrom(this.jobService.create(this.videoFile.name.replace(/\.[^/.]+$/, ''), { pipeline }, this.videoFile, 'studio'));
      if (res?.job?._id) { this.router.navigate(['/processing', res.job._id]); return; }
    } catch (e) { console.error('Export failed:', e); }
    this.processing = false;
  }
}
