import { Component, inject, OnInit, ViewChildren, QueryList, ElementRef, AfterViewInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { JobService, VideoJob } from '../core/job.service';

@Component({
  selector: 'app-preview',
  standalone: true,
  imports: [CommonModule, RouterLink],
  template: `
    <div class="preview-page">
      <header class="header">
        <button class="btn-back" routerLink="/dashboard">← Back</button>
        <h1 *ngIf="job">{{ job.title }}</h1>
        <div class="header-actions" *ngIf="job?.outputPath">
          <button class="btn-primary" (click)="download()">Download</button>
        </div>
      </header>

      <div class="content" *ngIf="job">
        <div class="comparison">
          <div class="viewer before">
            <div class="label">Before</div>
            <video #videoBefore [src]="getVideoUrl(job.inputPath, 'uploads')" muted playsinline preload="auto"></video>
          </div>
          <div class="viewer after" *ngIf="job.outputPath">
            <div class="label after-label">After — AI Enhanced</div>
            <video #videoAfter [src]="getVideoUrl(job.outputPath, 'outputs')" muted playsinline preload="auto"></video>
          </div>
        </div>

        <div class="playback-controls" *ngIf="job.outputPath">
          <button class="ctrl-btn" (click)="togglePlay()">
            {{ playing ? '⏸ Pause' : '▶ Play' }}
          </button>
          <button class="ctrl-btn" (click)="restart()">⏮ Restart</button>
          <label class="ctrl-label">
            <input type="range" min="0" max="100" step="0.1" [value]="progressPct" (input)="seek($event)" />
            <span>{{ currentTime | number:'1.1-1' }}s / {{ duration | number:'1.1-1' }}s</span>
          </label>
        </div>

        <div class="job-details">
          <h3>Enhancement Details</h3>
          <div class="details-grid">
            <div class="detail">
              <span class="detail-label">Status</span>
              <span class="detail-value status {{ job.status }}">{{ job.status }}</span>
            </div>
            <div class="detail">
              <span class="detail-label">Duration</span>
              <span class="detail-value">{{ job.inputDuration ? (job.inputDuration | number:'1.0-0') + 's' : '—' }}</span>
            </div>
            <div class="detail">
              <span class="detail-label">Resolution</span>
              <span class="detail-value">{{ job.inputResolution ? job.inputResolution.width + '×' + job.inputResolution.height : '—' }}</span>
            </div>
            <div class="detail">
              <span class="detail-label">Created</span>
              <span class="detail-value">{{ job.createdAt | date }}</span>
            </div>
          </div>

          <div class="pipeline-config" *ngIf="job.pipeline">
            <h4>Pipeline Settings</h4>
            <pre>{{ job.pipeline | json }}</pre>
          </div>
        </div>

        <div class="actions">
          <button class="btn-ghost" routerLink="/upload">New Enhancement</button>
          <button class="btn-ghost" routerLink="/dashboard">All Jobs</button>
        </div>
      </div>

      <div class="loading" *ngIf="!job">Loading...</div>
    </div>
  `,
  styles: [`
    .preview-page { min-height: 100vh; background: #0a0a0f; color: white; }
    .header {
      display: flex; align-items: center; gap: 16px; padding: 16px 32px;
      border-bottom: 1px solid #1a1a2e;
    }
    .header h1 { flex: 1; font-size: 18px; font-weight: 600; }
    .header-actions { display: flex; gap: 8px; }
    .btn-back { background: transparent; border: 1px solid #2a2a3e; color: #8888aa; padding: 8px 16px; border-radius: 8px; cursor: pointer; }
    .btn-primary {
      padding: 10px 20px; background: linear-gradient(135deg, #e94560, #ff6b6b);
      border: none; border-radius: 10px; color: white; font-size: 14px; font-weight: 600; cursor: pointer;
    }
    .btn-ghost { background: transparent; border: 1px solid #2a2a3e; color: #8888aa; padding: 10px 20px; border-radius: 10px; cursor: pointer; }
    .content { max-width: 1100px; margin: 0 auto; padding: 32px; }
    .comparison { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 8px; }
    .viewer { background: #0a0a0f; border: 1px solid #1e1e30; border-radius: 16px; overflow: hidden; }
    .label {
      padding: 8px 16px; font-size: 12px; font-weight: 600; text-transform: uppercase;
      letter-spacing: 1px; color: #8888aa; background: #14141f;
    }
    .after-label { color: #66cc66; }
    .viewer video { width: 100%; display: block; background: #000; }
    .playback-controls {
      display: flex; align-items: center; gap: 12px; padding: 12px 16px;
      background: #14141f; border: 1px solid #1e1e30; border-radius: 12px;
      margin-bottom: 24px;
    }
    .ctrl-btn {
      padding: 8px 16px; background: #1e1e30; border: none; border-radius: 8px;
      color: white; font-size: 13px; font-weight: 500; cursor: pointer; white-space: nowrap;
    }
    .ctrl-btn:hover { background: #2a2a3e; }
    .ctrl-label {
      display: flex; align-items: center; gap: 8px; flex: 1;
      color: #8888aa; font-size: 12px;
    }
    .ctrl-label input[type="range"] { flex: 1; accent-color: #e94560; }
    .job-details {
      background: #14141f; border: 1px solid #1e1e30; border-radius: 16px; padding: 24px; margin-bottom: 24px;
    }
    .job-details h3 { font-size: 16px; font-weight: 600; margin-bottom: 16px; }
    .details-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 16px; margin-bottom: 20px; }
    .detail { }
    .detail-label { display: block; font-size: 12px; color: #8888aa; margin-bottom: 4px; }
    .detail-value { font-size: 14px; font-weight: 500; }
    .detail-value.status.completed { color: #66cc66; }
    .detail-value.status.failed { color: #ff4444; }
    .pipeline-config h4 { font-size: 13px; color: #8888aa; margin-bottom: 8px; }
    .pipeline-config pre {
      background: #0a0a0f; padding: 16px; border-radius: 10px;
      font-size: 12px; color: #aaaacc; overflow-x: auto;
    }
    .actions { display: flex; gap: 12px; }
    .loading { text-align: center; padding: 64px; color: #8888aa; }
  `],
})
export class PreviewComponent implements OnInit, AfterViewInit {
  private route = inject(ActivatedRoute);
  private jobService = inject(JobService);

  job: VideoJob | null = null;

  @ViewChildren('videoBefore, videoAfter') videos!: QueryList<ElementRef<HTMLVideoElement>>;

  playing = false;
  currentTime = 0;
  duration = 0;
  progressPct = 0;
  private syncGuard = false;

  ngOnInit() {
    const id = this.route.snapshot.paramMap.get('id')!;
    this.jobService.get(id).subscribe({
      next: (res) => {
        this.job = res.job;
        if (this.job?.inputDuration) this.duration = this.job.inputDuration;
        setTimeout(() => this.attachVideoEvents());
      },
      error: () => (this.job = null),
    });
  }

  ngAfterViewInit() {
    this.videos.changes.subscribe(() => this.attachVideoEvents());
    this.attachVideoEvents();
  }

  private get vids(): HTMLVideoElement[] {
    return this.videos?.toArray()?.map(v => v.nativeElement) || [];
  }

  private attachVideoEvents() {
    for (const v of this.vids) {
      if ((v as any)._previewEventsAttached) continue;
      (v as any)._previewEventsAttached = true;
      v.addEventListener('loadedmetadata', () => {
        if (v.duration && !this.duration) this.duration = v.duration;
      });
      v.addEventListener('timeupdate', () => {
        if (this.syncGuard) return;
        this.syncGuard = true;
        const t = v.currentTime;
        this.currentTime = t;
        this.progressPct = v.duration > 0 ? (t / v.duration) * 100 : 0;
        for (const other of this.vids) {
          if (other !== v && Math.abs(other.currentTime - t) > 0.3) {
            other.currentTime = t;
          }
        }
        this.syncGuard = false;
      });
      v.addEventListener('ended', () => { this.playing = false; });
      v.addEventListener('play', () => { this.playing = true; });
      v.addEventListener('pause', () => { this.playing = false; });
    }
  }

  togglePlay() {
    const v = this.vids;
    if (!v.length) return;
    if (this.playing) {
      v.forEach(x => x.pause());
    } else {
      if (v[0].ended) {
        v.forEach(x => { x.currentTime = 0; });
      }
      v.forEach(x => x.play().catch(() => {}));
    }
  }

  restart() {
    this.vids.forEach(x => { x.currentTime = 0; x.play().catch(() => {}); });
    this.playing = true;
  }

  seek(e: Event) {
    const pct = parseFloat((e.target as HTMLInputElement).value);
    const t = (pct / 100) * this.duration;
    this.vids.forEach(x => { x.currentTime = t; });
  }

  getVideoUrl(p: string, type: string): string {
    const idx = p.indexOf(`\\${type}\\`);
    if (idx !== -1) return p.slice(idx).replace(/\\/g, '/');
    const idx2 = p.indexOf(`/${type}/`);
    if (idx2 !== -1) return p.slice(idx2);
    const filename = p.split('\\').pop() || p.split('/').pop();
    return `/${type}/${filename}`;
  }

  download() {
    if (this.job?.outputPath) {
      const a = document.createElement('a');
      a.href = this.getVideoUrl(this.job.outputPath, 'outputs');
      a.download = `${this.job.title}_enhanced.mp4`;
      a.click();
    }
  }
}
