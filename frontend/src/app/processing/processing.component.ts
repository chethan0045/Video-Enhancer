import { Component, inject, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { JobService, VideoJob } from '../core/job.service';

@Component({
  selector: 'app-processing',
  standalone: true,
  imports: [CommonModule, RouterLink],
  template: `
    <div class="processing-page">
      <header class="header">
        <button class="btn-back" routerLink="/dashboard">← Back</button>
        <h1 *ngIf="job">{{ job.title }}</h1>
      </header>

      <div class="content" *ngIf="job">
        <div class="status-card">
          <div class="status-icon">
            <span *ngIf="job.status === 'queued'">⏳</span>
            <span *ngIf="isProcessing()"><span class="spinner"></span></span>
            <span *ngIf="job.status === 'completed'">✅</span>
            <span *ngIf="job.status === 'failed'">❌</span>
            <span *ngIf="job.status === 'cancelled'">⏹️</span>
          </div>
          <div class="status-text">
            <h3>{{ getStatusText() }}</h3>
            <p>{{ job.createdAt | date:'medium' }}</p>
          </div>
        </div>

        <div class="progress-section" *ngIf="isProcessing() || job.status === 'queued'">
          <div class="progress-ring">
            <svg viewBox="0 0 100 100">
              <circle cx="50" cy="50" r="45" class="ring-bg" />
              <circle cx="50" cy="50" r="45" class="ring-fill"
                [style.stroke-dasharray]="circumference"
                [style.stroke-dashoffset]="circumference - (job.progress / 100) * circumference" />
            </svg>
            <span class="progress-text">{{ job.progress }}%</span>
          </div>
        </div>

        <div class="stages" *ngIf="job.pipelineStages?.length">
          <h4>Pipeline Stages</h4>
          <div class="stage-list">
            <div class="stage-item" *ngFor="let stage of job.pipelineStages"
                 [class.completed]="stage.status === 'completed'"
                 [class.active]="stage.status === 'processing'"
                 [class.failed]="stage.status === 'failed'">
              <div class="stage-indicator">
                <span *ngIf="stage.status === 'completed'" class="check">✓</span>
                <span *ngIf="stage.status === 'processing'" class="pulse-dot"></span>
                <span *ngIf="stage.status === 'pending'">○</span>
                <span *ngIf="stage.status === 'failed'">✗</span>
              </div>
              <div class="stage-info">
                <span class="stage-name">{{ formatStageName(stage.name) }}</span>
                <span class="stage-status">{{ stage.status }}</span>
              </div>
              <div class="stage-bar" *ngIf="stage.status === 'processing'">
                <div class="stage-bar-fill" [style.width.%]="stage.progress"></div>
              </div>
            </div>
          </div>
        </div>

        <div class="eta" *ngIf="isProcessing() && eta > 0">
          Estimated time remaining: ~{{ eta }}s
        </div>

        <div class="actions">
          <button *ngIf="job.status === 'completed'" class="btn-primary" [routerLink]="['/preview', job._id]">
            View Result →
          </button>
          <button *ngIf="job.status === 'failed'" class="btn-primary" (click)="retry()">Retry</button>
          <button *ngIf="isProcessing() || job.status === 'queued'" class="btn-ghost" (click)="cancel()">Cancel</button>
          <button *ngIf="isFinished()" class="btn-ghost" [routerLink]="newRoute()">{{ newLabel() }}</button>
        </div>

        <div class="error-box" *ngIf="job.error">
          <h5>Error</h5>
          <p>{{ job.error }}</p>
        </div>
      </div>

      <div class="loading" *ngIf="!job">Loading job...</div>
    </div>
  `,
  styles: [`
    .processing-page { min-height: 100vh; background: #0a0a0f; color: white; }
    .header { display: flex; align-items: center; gap: 16px; padding: 16px 32px; border-bottom: 1px solid #1a1a2e; }
    .header h1 { font-size: 18px; font-weight: 600; }
    .btn-back { background: transparent; border: 1px solid #2a2a3e; color: #8888aa; padding: 8px 16px; border-radius: 8px; cursor: pointer; }
    .content { max-width: 700px; margin: 0 auto; padding: 32px; }
    .status-card { display: flex; align-items: center; gap: 16px; background: #14141f; border: 1px solid #1e1e30; border-radius: 16px; padding: 24px; margin-bottom: 24px; }
    .status-icon { font-size: 32px; width: 48px; text-align: center; }
    .spinner { display: inline-block; width: 24px; height: 24px; border: 3px solid #2a2a3e; border-top-color: #e94560; border-radius: 50%; animation: spin 0.8s linear infinite; }
    .status-text h3 { font-size: 18px; font-weight: 600; margin-bottom: 4px; }
    .status-text p { font-size: 13px; color: #8888aa; }
    .progress-section { text-align: center; margin-bottom: 32px; }
    .progress-ring { position: relative; display: inline-block; width: 120px; height: 120px; }
    .progress-ring svg { width: 100%; height: 100%; transform: rotate(-90deg); }
    .ring-bg { fill: none; stroke: #1e1e30; stroke-width: 6; }
    .ring-fill { fill: none; stroke: #e94560; stroke-width: 6; stroke-linecap: round; transition: stroke-dashoffset 0.5s; }
    .progress-text { position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); font-size: 24px; font-weight: 700; }
    .stages { margin-bottom: 24px; }
    .stages h4 { font-size: 14px; color: #8888aa; margin-bottom: 12px; text-transform: uppercase; letter-spacing: 1px; }
    .stage-list { display: flex; flex-direction: column; gap: 6px; }
    .stage-item { display: flex; align-items: center; gap: 12px; padding: 10px 14px; background: #14141f; border: 1px solid #1e1e30; border-radius: 10px; transition: all 0.2s; }
    .stage-item.active { border-color: #e94560; background: #1e1018; }
    .stage-item.completed { border-color: #1e2e1e; opacity: 0.8; }
    .stage-item.completed .check { color: #66cc66; }
    .stage-item.failed { border-color: #2e1e1e; }
    .stage-indicator { width: 20px; text-align: center; font-size: 13px; color: #555577; }
    .pulse-dot { display: inline-block; width: 8px; height: 8px; background: #e94560; border-radius: 50%; animation: pulse 1.5s infinite; }
    .stage-info { flex: 1; display: flex; justify-content: space-between; }
    .stage-name { font-size: 13px; font-weight: 500; text-transform: capitalize; }
    .stage-status { font-size: 11px; color: #8888aa; text-transform: capitalize; }
    .stage-bar { width: 60px; height: 4px; background: #1e1e30; border-radius: 2px; overflow: hidden; }
    .stage-bar-fill { height: 100%; background: #e94560; border-radius: 2px; transition: width 0.3s; }
    .eta { text-align: center; color: #8888aa; font-size: 13px; margin-bottom: 16px; }
    .actions { display: flex; gap: 12px; margin-bottom: 24px; }
    .btn-primary { padding: 14px 24px; background: linear-gradient(135deg, #e94560, #ff6b6b); border: none; border-radius: 12px; color: white; font-size: 14px; font-weight: 600; cursor: pointer; }
    .btn-ghost { background: transparent; border: 1px solid #2a2a3e; color: #8888aa; padding: 14px 24px; border-radius: 12px; cursor: pointer; }
    .btn-primary:disabled, .btn-ghost:disabled { opacity: 0.5; cursor: not-allowed; }
    .error-box { background: #1e1010; border: 1px solid #2e1515; border-radius: 12px; padding: 16px; }
    .error-box h5 { color: #ff4444; margin-bottom: 8px; }
    .error-box p { color: #ff8888; font-size: 13px; }
    .loading { text-align: center; padding: 64px; color: #8888aa; }
    @keyframes spin { to { transform: rotate(360deg); } }
    @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.3; } }
  `],
})
export class ProcessingComponent implements OnInit, OnDestroy {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private jobService = inject(JobService);

  job: VideoJob | null = null;
  circumference = 2 * Math.PI * 45;
  eta = 0;
  private pollTimer: any = null;

  ngOnInit() {
    const id = this.route.snapshot.paramMap.get('id')!;
    this.loadJob(id);
    this.pollTimer = setInterval(() => this.loadJob(id), 1500);
  }

  ngOnDestroy() {
    if (this.pollTimer) clearInterval(this.pollTimer);
  }

  loadJob(id: string) {
    this.jobService.get(id).subscribe({
      next: (res) => {
        this.job = res.job;
        if (res.job.progress > 0 && res.job.progress < 100) {
          const elapsed = (Date.now() - new Date(res.job.createdAt).getTime()) / 1000;
          this.eta = Math.round((elapsed / res.job.progress) * (100 - res.job.progress));
        }
        if (res.job.status === 'completed') {
          clearInterval(this.pollTimer);
          setTimeout(() => this.router.navigate(['/preview', id]), 800);
        }
        if (['failed', 'cancelled'].includes(res.job.status)) {
          clearInterval(this.pollTimer);
        }
      },
      error: () => { },
    });
  }

  isProcessing() {
    return ['queued', 'extracting', 'processing', 'enhancing', 'rebuilding', 'exporting'].includes(this.job?.status || '');
  }

  isFinished() {
    return ['completed', 'failed', 'cancelled'].includes(this.job?.status || '');
  }

  getStatusText(): string {
    if (!this.job) return '';
    const mode = this.job.mode || 'enhance';
    const processingLabel: Record<string, string> = {
      enhance: 'AI Processing', edit: 'Editing video', merge: 'Merging clips',
      'extract-audio': 'Extracting audio', subtitle: 'Transcribing audio', 'denoise-audio': 'Removing noise', studio: 'Processing your edit',
    };
    const doneLabel: Record<string, string> = {
      enhance: '✓ Enhancement complete', edit: '✓ Edit complete', merge: '✓ Merge complete',
      'extract-audio': '✓ Audio extracted', subtitle: '✓ Subtitles ready', 'denoise-audio': '✓ Noise removed', studio: '✓ Export ready',
    };
    const map: Record<string, string> = {
      queued: 'Waiting in queue', extracting: 'Extracting frames',
      processing: processingLabel[mode] || 'Processing',
      enhancing: 'AI Enhancement', rebuilding: 'Rebuilding video', exporting: 'Exporting',
      completed: doneLabel[mode] || '✓ Complete',
      failed: 'Processing failed', cancelled: 'Cancelled',
    };
    return map[this.job.status] || this.job.status;
  }

  newRoute(): string {
    return ({ studio: '/studio', edit: '/editor', merge: '/merge', 'extract-audio': '/extract-audio', subtitle: '/subtitles', 'denoise-audio': '/denoise-audio' } as any)[this.job?.mode || 'enhance'] || '/upload';
  }

  newLabel(): string {
    return ({ studio: 'New Project', edit: 'New Edit', merge: 'New Merge', 'extract-audio': 'Extract Another', subtitle: 'New Subtitles', 'denoise-audio': 'Clean Another' } as any)[this.job?.mode || 'enhance'] || 'New Enhancement';
  }

  formatStageName(name: string): string {
    return name.replace(/_/g, ' ').replace(/\b\w/g, (l) => l.toUpperCase());
  }

  retry() {
    if (!this.job) return;
    const id = this.job._id;
    this.jobService.retry(id).subscribe(() => {
      this.pollTimer = setInterval(() => this.loadJob(id), 1500);
    });
  }

  cancel() {
    if (!this.job) return;
    this.jobService.cancel(this.job._id).subscribe((res) => (this.job = res.job));
  }
}
