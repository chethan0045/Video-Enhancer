import { Component, inject, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { AuthService } from '../core/auth.service';
import { JobService, VideoJob } from '../core/job.service';

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [CommonModule, RouterLink],
  template: `
    <div class="dashboard">
      <header class="header">
        <div class="header-left">
          <h1>CineRemaster</h1>
          <span class="badge">AI Cinema Engine</span>
        </div>
        <div class="header-right">
          <span class="user-name">{{ user?.name }}</span>
          <span class="plan {{ user?.subscription }}">{{ user?.subscription }}</span>
          <button class="btn-ghost" (click)="auth.logout()">Logout</button>
        </div>
      </header>

      <div class="hero">
        <h2>AI Cinematic Video Remaster</h2>
        <p>Open the all-in-one Studio to trim, crop, enhance, clean audio and auto-subtitle in one place — or use a quick single-purpose tool.</p>
        <button class="btn-studio" routerLink="/studio">🎬 Open Studio — All-in-one Editor</button>
        <div class="tool-cards">
          <div class="tool-card" routerLink="/upload">
            <div class="tool-icon">✨</div>
            <h3>Enhance Video</h3>
            <p>Upscale to clean, sharp 8K with denoise, deblur and color grading.</p>
            <span class="tool-cta">Enhance →</span>
          </div>
          <div class="tool-card" routerLink="/editor">
            <div class="tool-icon">✂</div>
            <h3>Edit Video</h3>
            <p>Trim and crop your clip and export it — no enhancement applied.</p>
            <span class="tool-cta">Edit →</span>
          </div>
          <div class="tool-card" routerLink="/merge">
            <div class="tool-icon">🎞️</div>
            <h3>Merge Clips</h3>
            <p>Join multiple videos into one; different sizes are auto-fitted.</p>
            <span class="tool-cta">Merge →</span>
          </div>
          <div class="tool-card" routerLink="/extract-audio">
            <div class="tool-icon">🎵</div>
            <h3>Extract Audio</h3>
            <p>Pull the audio track out as MP3, M4A or WAV.</p>
            <span class="tool-cta">Extract →</span>
          </div>
          <div class="tool-card" routerLink="/subtitles">
            <div class="tool-icon">💬</div>
            <h3>Generate Subtitles</h3>
            <p>Auto-transcribe speech to an .srt file with Whisper.</p>
            <span class="tool-cta">Subtitles →</span>
          </div>
          <div class="tool-card" routerLink="/denoise-audio">
            <div class="tool-icon">🔇</div>
            <h3>Remove Noise</h3>
            <p>Clean hiss, hum and background noise from the audio.</p>
            <span class="tool-cta">Clean Audio →</span>
          </div>
        </div>
      </div>

      <section class="recent">
        <div class="section-header">
          <h3>Recent Jobs</h3>
          <button class="btn-ghost" (click)="loadJobs()" [disabled]="loading">Refresh</button>
        </div>

        <div *ngIf="loading" class="loading">Loading...</div>

        <div *ngIf="!loading && jobs.length === 0" class="empty">
          <p>No jobs yet</p>
          <div class="empty-actions">
            <button class="btn-primary" routerLink="/upload">Enhance a Video</button>
            <button class="btn-ghost" routerLink="/editor">Edit a Video</button>
          </div>
        </div>

        <div class="job-grid" *ngIf="!loading && jobs.length > 0">
          <div class="job-card" *ngFor="let job of jobs" [routerLink]="['/processing', job._id]">
            <div class="job-top">
              <div class="job-status {{ job.status }}">
                <span class="status-dot"></span>
                {{ job.status }}
              </div>
              <span class="mode-tag {{ job.mode || 'enhance' }}">{{ modeLabel(job.mode) }}</span>
            </div>
            <h4>{{ job.title }}</h4>
            <div class="job-meta">
              <span>{{ job.inputDuration ? (job.inputDuration | number:'1.0-0') + 's' : '—' }}</span>
              <span *ngIf="job.inputResolution">{{ job.inputResolution.width }}×{{ job.inputResolution.height }}</span>
            </div>
            <div class="progress-bar" *ngIf="job.status === 'processing' || job.status === 'queued'">
              <div class="progress-fill" [style.width.%]="job.progress"></div>
            </div>
            <div class="job-date">{{ job.createdAt | date:'medium' }}</div>
          </div>
        </div>
      </section>
    </div>
  `,
  styles: [`
    .dashboard { min-height: 100vh; background: #0a0a0f; color: white; }
    .header {
      display: flex; justify-content: space-between; align-items: center;
      padding: 16px 32px; border-bottom: 1px solid #1a1a2e;
    }
    .header-left { display: flex; align-items: center; gap: 12px; }
    .header-left h1 {
      font-size: 20px; font-weight: 700;
      background: linear-gradient(135deg, #e94560, #ff6b6b);
      -webkit-background-clip: text; -webkit-text-fill-color: transparent;
    }
    .badge { font-size: 11px; padding: 3px 8px; background: #1e1e30; border-radius: 6px; color: #8888aa; }
    .header-right { display: flex; align-items: center; gap: 16px; }
    .user-name { color: #ccccee; font-size: 14px; }
    .plan { font-size: 11px; padding: 3px 10px; border-radius: 20px; text-transform: capitalize; }
    .plan.free { background: #1e1e30; color: #8888aa; }
    .plan.basic { background: #1a2e1a; color: #66cc66; }
    .plan.pro { background: #1a1a3e; color: #8888ff; }
    .hero {
      text-align: center; padding: 80px 32px 64px;
      background: radial-gradient(ellipse at 50% 0%, #1a1a2e 0%, transparent 70%);
    }
    .hero h2 { font-size: 36px; font-weight: 700; margin-bottom: 12px; }
    .hero p { color: #8888aa; font-size: 16px; max-width: 560px; margin: 0 auto 32px; line-height: 1.6; }
    .btn-studio { display: inline-block; margin-bottom: 28px; padding: 16px 32px; background: linear-gradient(135deg, #3B82F6, #6366f1); border: none; border-radius: 14px; color: #fff; font-size: 16px; font-weight: 700; cursor: pointer; box-shadow: 0 8px 24px rgba(59,130,246,.3); }
    .btn-studio:hover { transform: translateY(-2px); }
    .tool-cards { display: flex; gap: 20px; justify-content: center; flex-wrap: wrap; }
    .tool-card {
      width: 300px; text-align: left; background: #14141f; border: 1px solid #1e1e30;
      border-radius: 18px; padding: 24px; cursor: pointer; transition: all 0.2s;
    }
    .tool-card:hover { border-color: #e94560; transform: translateY(-3px); }
    .tool-icon { font-size: 30px; margin-bottom: 12px; }
    .tool-card h3 { font-size: 18px; font-weight: 700; margin-bottom: 8px; }
    .tool-card p { color: #8888aa; font-size: 13px; line-height: 1.5; margin: 0 0 16px; }
    .tool-cta { font-size: 14px; font-weight: 600; color: #e94560; }
    .empty-actions { display: flex; gap: 12px; justify-content: center; }
    .job-top { display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px; }
    .mode-tag { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; padding: 3px 8px; border-radius: 6px; }
    .mode-tag.enhance { background: #1a1a3e; color: #8888ff; }
    .mode-tag.edit { background: #2e2410; color: #ffcc66; }
    .mode-tag.merge { background: #102a2e; color: #66dddd; }
    .mode-tag.extract-audio { background: #2a102e; color: #dd88ff; }
    .mode-tag.subtitle { background: #102e1a; color: #66cc99; }
    .mode-tag.denoise-audio { background: #2e2218; color: #ddaa77; }
    .btn-primary {
      padding: 14px 32px; background: linear-gradient(135deg, #e94560, #ff6b6b);
      border: none; border-radius: 12px; color: white; font-size: 15px;
      font-weight: 600; cursor: pointer;
    }
    .btn-ghost { background: transparent; border: 1px solid #2a2a3e; color: #8888aa; padding: 8px 16px; border-radius: 8px; cursor: pointer; }
    .recent { padding: 0 32px 64px; max-width: 1200px; margin: 0 auto; }
    .section-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; }
    .section-header h3 { font-size: 18px; font-weight: 600; }
    .loading, .empty { text-align: center; padding: 48px; color: #8888aa; }
    .empty p { margin-bottom: 16px; }
    .job-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 16px; }
    .job-card {
      background: #14141f; border: 1px solid #1e1e30; border-radius: 16px;
      padding: 20px; cursor: pointer; transition: all 0.2s;
    }
    .job-card:hover { border-color: #2a2a4e; transform: translateY(-2px); }
    .job-status {
      display: flex; align-items: center; gap: 6px;
      font-size: 12px; text-transform: capitalize; margin-bottom: 8px;
    }
    .status-dot { width: 8px; height: 8px; border-radius: 50%; }
    .job-status.completed .status-dot { background: #66cc66; }
    .job-status.processing .status-dot, .job-status.queued .status-dot { background: #ffcc00; animation: pulse 1.5s infinite; }
    .job-status.failed .status-dot { background: #ff4444; }
    .job-status.completed { color: #66cc66; }
    .job-status.processing { color: #ffcc00; }
    .job-status.failed { color: #ff4444; }
    .job-card h4 { font-size: 15px; font-weight: 600; margin-bottom: 8px; }
    .job-meta { display: flex; gap: 12px; font-size: 12px; color: #666688; margin-bottom: 12px; }
    .progress-bar { height: 4px; background: #1e1e30; border-radius: 2px; margin-bottom: 8px; overflow: hidden; }
    .progress-fill { height: 100%; background: linear-gradient(90deg, #e94560, #ff6b6b); border-radius: 2px; transition: width 0.3s; }
    .job-date { font-size: 11px; color: #555577; }
    @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } }
  `],
})
export class DashboardComponent implements OnInit, OnDestroy {
  private jobService = inject(JobService);
  auth = inject(AuthService);

  user = this.auth.getUser();
  jobs: VideoJob[] = [];
  loading = true;
  private pollTimer: any = null;

  modeLabel(mode?: string): string {
    const labels: Record<string, string> = { enhance: 'Enhance', edit: 'Edit', merge: 'Merge', 'extract-audio': 'Audio', subtitle: 'Subtitles', 'denoise-audio': 'Denoise', studio: 'Studio' };
    return labels[mode || 'enhance'] || 'Enhance';
  }

  ngOnInit() {
    this.loadJobs();
    this.pollTimer = setInterval(() => this.loadJobs(true), 3000);
  }

  ngOnDestroy() {
    if (this.pollTimer) clearInterval(this.pollTimer);
  }

  loadJobs(silent = false) {
    if (!silent) this.loading = true;
    this.jobService.list().subscribe({
      next: (res) => {
        this.jobs = res.jobs;
        this.loading = false;
      },
      error: () => (this.loading = false),
    });
  }
}
