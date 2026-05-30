import { Component, inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { JobService } from '../core/job.service';

type ToolMode = 'extract-audio' | 'subtitle' | 'denoise-audio';

@Component({
  selector: 'app-tool',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  template: `
    <div class="page">
      <header class="header">
        <button class="btn-back" routerLink="/dashboard">← Back</button>
        <h1>{{ meta.title }}</h1>
      </header>

      <div class="content">
        <div class="dropzone" *ngIf="!file"
             (dragover)="onDragOver($event)" (dragleave)="dragging=false" (drop)="onDrop($event)"
             [class.dragging]="dragging">
          <div class="icon">{{ meta.icon }}</div>
          <h3>{{ meta.drop }}</h3>
          <p>{{ meta.hint }}</p>
          <input type="file" #fileInput accept="video/*" (change)="onSelect($event)" hidden />
          <button class="btn-outline" (click)="fileInput.click()">Browse Files</button>
        </div>

        <div class="panel" *ngIf="file">
          <div class="fileinfo">
            <span class="ficon">🎬</span>
            <div class="fdetails"><h4>{{ file.name }}</h4><p>{{ formatSize(file.size) }}</p></div>
            <button class="btn-ghost" (click)="file=null">Remove</button>
          </div>

          <div class="setting">
            <label>Title</label>
            <input type="text" [(ngModel)]="title" placeholder="My file" />
          </div>

          <div class="setting" *ngIf="mode === 'extract-audio'">
            <label>Audio Format</label>
            <select [(ngModel)]="audioFormat">
              <option value="mp3">MP3</option>
              <option value="m4a">M4A (AAC)</option>
              <option value="wav">WAV (lossless)</option>
            </select>
          </div>

          <ng-container *ngIf="mode === 'subtitle'">
            <div class="setting">
              <label>Accuracy</label>
              <select [(ngModel)]="whisperModel">
                <option value="tiny">Tiny — fastest</option>
                <option value="base">Base</option>
                <option value="small">Small — most accurate</option>
              </select>
            </div>
            <div class="setting">
              <label>Language</label>
              <select [(ngModel)]="language">
                <option value="auto">Auto-detect</option>
                <option value="en">English</option>
                <option value="kn">Kannada</option>
                <option value="te">Telugu</option>
                <option value="hi">Hindi</option>
                <option value="ta">Tamil</option>
              </select>
            </div>
            <div class="setting">
              <label>Translate to (AI)</label>
              <select [(ngModel)]="translateTo">
                <option value="none">No translation</option>
                <option value="en">English</option><option value="kn">Kannada</option><option value="hi">Hindi</option>
                <option value="ta">Tamil</option><option value="te">Telugu</option><option value="ml">Malayalam</option>
              </select>
            </div>
            <div class="setting checkbox-row">
              <label><input type="checkbox" [(ngModel)]="cleanup" /> Clean up text with AI (punctuation/casing)</label>
            </div>
            <div class="setting">
              <label>Output</label>
              <select [(ngModel)]="subtitleOutput">
                <option value="burn">Burn into video (always visible)</option>
                <option value="embed">Embed as toggleable track</option>
                <option value="srt">Subtitle file (.srt) only</option>
              </select>
            </div>
          </ng-container>

          <div class="setting" *ngIf="mode === 'denoise-audio'">
            <label>Noise reduction strength — {{ noiseStrength }}</label>
            <input type="range" min="0" max="1" step="0.1" [(ngModel)]="noiseStrength" />
          </div>

          <button class="btn-primary" (click)="start()" [disabled]="processing">
            {{ processing ? 'Creating Job...' : meta.cta }}
          </button>
        </div>
      </div>
    </div>
  `,
  styles: [`
    .page { min-height: 100vh; background: #0a0a0f; color: white; }
    .header { display: flex; align-items: center; gap: 16px; padding: 16px 32px; border-bottom: 1px solid #1a1a2e; }
    .header h1 { font-size: 18px; font-weight: 600; }
    .btn-back { background: transparent; border: 1px solid #2a2a3e; color: #8888aa; padding: 8px 16px; border-radius: 8px; cursor: pointer; }
    .content { max-width: 640px; margin: 0 auto; padding: 32px; }
    .dropzone { border: 2px dashed #2a2a3e; border-radius: 20px; padding: 56px 32px; text-align: center; transition: all 0.3s; }
    .dropzone.dragging { border-color: #e94560; background: #1a1015; }
    .dropzone .icon { font-size: 42px; margin-bottom: 14px; }
    .dropzone h3 { font-size: 18px; margin-bottom: 8px; }
    .dropzone p { color: #8888aa; font-size: 14px; margin-bottom: 18px; }
    .btn-outline { padding: 12px 24px; background: transparent; border: 1px solid #2a2a3e; border-radius: 10px; color: white; cursor: pointer; }
    .btn-outline:hover { border-color: #e94560; }
    .panel { display: flex; flex-direction: column; gap: 14px; }
    .fileinfo { display: flex; align-items: center; gap: 14px; background: #14141f; border: 1px solid #1e1e30; border-radius: 14px; padding: 16px; }
    .ficon { font-size: 28px; }
    .fdetails { flex: 1; } .fdetails h4 { font-size: 14px; margin-bottom: 4px; } .fdetails p { font-size: 12px; color: #8888aa; }
    .btn-ghost { background: transparent; border: 1px solid #2a2a3e; color: #8888aa; padding: 8px 14px; border-radius: 8px; cursor: pointer; }
    .setting { display: flex; flex-direction: column; gap: 6px; }
    .setting label { font-size: 13px; color: #aaaacc; }
    .setting input, .setting select { background: #14141f; border: 1px solid #2a2a3e; border-radius: 10px; padding: 10px 14px; color: white; font-size: 14px; outline: none; }
    .btn-primary { margin-top: 6px; padding: 14px; background: linear-gradient(135deg, #e94560, #ff6b6b); border: none; border-radius: 12px; color: white; font-size: 15px; font-weight: 600; cursor: pointer; }
    .btn-primary:disabled { opacity: 0.5; cursor: not-allowed; }
  `],
})
export class ToolComponent implements OnInit {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private jobService = inject(JobService);

  mode: ToolMode = 'extract-audio';
  file: File | null = null;
  dragging = false;
  processing = false;
  title = '';

  audioFormat = 'mp3';
  whisperModel = 'tiny';
  language = 'auto';
  subtitleOutput = 'burn';
  translateTo = 'none';
  cleanup = false;
  noiseStrength = 0.6;

  private metaByMode: Record<ToolMode, any> = {
    'extract-audio': { title: 'Extract Audio', icon: '🎵', drop: 'Drop a video to extract its audio',
      hint: 'Pulls the audio track out as MP3, M4A or WAV.', cta: 'Extract Audio →' },
    'subtitle': { title: 'Auto Subtitles', icon: '💬', drop: 'Drop a video to subtitle',
      hint: 'Transcribes speech with Whisper and adds the captions to your video (or exports an .srt).', cta: 'Add Subtitles →' },
    'denoise-audio': { title: 'Remove Background Noise', icon: '🔇', drop: 'Drop a video to clean its audio',
      hint: 'Removes hiss, hum and background noise from the audio track.', cta: 'Remove Noise →' },
  };
  get meta() { return this.metaByMode[this.mode]; }

  ngOnInit() {
    this.mode = (this.route.snapshot.data['mode'] as ToolMode) || 'extract-audio';
  }

  onDragOver(e: DragEvent) { e.preventDefault(); this.dragging = true; }
  onDrop(e: DragEvent) {
    e.preventDefault(); this.dragging = false;
    const f = e.dataTransfer?.files[0];
    if (f && f.type.startsWith('video/')) this.load(f);
  }
  onSelect(e: any) { const f = e.target.files?.[0]; if (f) this.load(f); }
  private load(f: File) { this.file = f; this.title = f.name.replace(/\.[^/.]+$/, ''); }

  formatSize(b: number): string {
    if (b < 1024 * 1024) return `${(b / 1024).toFixed(0)} KB`;
    if (b < 1024 * 1024 * 1024) return `${(b / (1024 * 1024)).toFixed(1)} MB`;
    return `${(b / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  }

  async start() {
    if (!this.file || this.processing) return;
    this.processing = true;
    const pipelineByMode: Record<ToolMode, any> = {
      'extract-audio': { audioFormat: this.audioFormat },
      'subtitle': { whisperModel: this.whisperModel, language: this.language, subtitleOutput: this.subtitleOutput, translateTo: this.translateTo, cleanup: this.cleanup },
      'denoise-audio': { noiseStrength: this.noiseStrength },
    };
    const settings = { pipeline: pipelineByMode[this.mode] };
    try {
      const res = await firstValueFrom(this.jobService.create(this.title || 'Untitled', settings, this.file, this.mode));
      if (res?.job?._id) this.router.navigate(['/processing', res.job._id]);
    } catch (err) {
      console.error('Job failed:', err);
      this.processing = false;
    }
  }
}
