import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { JobService } from '../core/job.service';

@Component({
  selector: 'app-merge',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  template: `
    <div class="page">
      <header class="header">
        <button class="btn-back" routerLink="/dashboard">← Back</button>
        <h1>Merge Clips</h1>
      </header>

      <div class="content">
        <div class="dropzone" (dragover)="onDragOver($event)" (dragleave)="dragging=false" (drop)="onDrop($event)"
             [class.dragging]="dragging">
          <div class="icon">🎞️</div>
          <h3>Add clips to merge</h3>
          <p>They'll be joined in the order below — different sizes are auto-fitted to the first clip.</p>
          <input type="file" #fileInput accept="video/*" multiple (change)="onSelect($event)" hidden />
          <button class="btn-outline" (click)="fileInput.click()">Add Videos</button>
        </div>

        <div class="clips" *ngIf="files.length">
          <div class="clip" *ngFor="let f of files; let i = index">
            <span class="num">{{ i + 1 }}</span>
            <span class="name">{{ f.name }}</span>
            <span class="size">{{ formatSize(f.size) }}</span>
            <span class="ops">
              <button (click)="move(i,-1)" [disabled]="i===0" title="Move up">↑</button>
              <button (click)="move(i,1)" [disabled]="i===files.length-1" title="Move down">↓</button>
              <button (click)="remove(i)" title="Remove">✕</button>
            </span>
          </div>

          <div class="setting">
            <label>Title</label>
            <input type="text" [(ngModel)]="title" placeholder="Merged video" />
          </div>

          <button class="btn-primary" (click)="start()" [disabled]="processing || files.length < 2">
            {{ processing ? 'Creating Job...' : (files.length < 2 ? 'Add at least 2 clips' : 'Merge ' + files.length + ' Clips →') }}
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
    .content { max-width: 760px; margin: 0 auto; padding: 32px; }
    .dropzone { border: 2px dashed #2a2a3e; border-radius: 20px; padding: 48px; text-align: center; transition: all 0.3s; }
    .dropzone.dragging { border-color: #e94560; background: #1a1015; }
    .dropzone .icon { font-size: 40px; margin-bottom: 12px; }
    .dropzone h3 { font-size: 18px; margin-bottom: 8px; }
    .dropzone p { color: #8888aa; font-size: 14px; margin-bottom: 18px; }
    .btn-outline { padding: 12px 24px; background: transparent; border: 1px solid #2a2a3e; border-radius: 10px; color: white; cursor: pointer; }
    .btn-outline:hover { border-color: #e94560; }
    .clips { margin-top: 24px; display: flex; flex-direction: column; gap: 8px; }
    .clip { display: flex; align-items: center; gap: 12px; background: #14141f; border: 1px solid #1e1e30; border-radius: 10px; padding: 10px 14px; }
    .clip .num { width: 22px; height: 22px; flex-shrink: 0; display: flex; align-items: center; justify-content: center; background: #e94560; border-radius: 50%; font-size: 12px; font-weight: 700; }
    .clip .name { flex: 1; font-size: 13px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .clip .size { font-size: 12px; color: #8888aa; }
    .clip .ops { display: flex; gap: 4px; }
    .clip .ops button { width: 28px; height: 28px; background: #1e1e30; border: none; border-radius: 6px; color: #aaaacc; cursor: pointer; }
    .clip .ops button:disabled { opacity: 0.3; cursor: not-allowed; }
    .clip .ops button:hover:not(:disabled) { background: #2a2a3e; color: white; }
    .setting { display: flex; flex-direction: column; gap: 6px; margin: 16px 0 8px; }
    .setting label { font-size: 13px; color: #aaaacc; }
    .setting input { background: #14141f; border: 1px solid #2a2a3e; border-radius: 10px; padding: 10px 14px; color: white; font-size: 14px; outline: none; }
    .btn-primary { margin-top: 8px; padding: 14px; background: linear-gradient(135deg, #e94560, #ff6b6b); border: none; border-radius: 12px; color: white; font-size: 15px; font-weight: 600; cursor: pointer; }
    .btn-primary:disabled { opacity: 0.5; cursor: not-allowed; }
  `],
})
export class MergeComponent {
  private jobService = inject(JobService);
  private router = inject(Router);

  files: File[] = [];
  title = 'Merged video';
  dragging = false;
  processing = false;

  onDragOver(e: DragEvent) { e.preventDefault(); this.dragging = true; }
  onDrop(e: DragEvent) {
    e.preventDefault();
    this.dragging = false;
    this.addFiles(Array.from(e.dataTransfer?.files || []));
  }
  onSelect(e: any) { this.addFiles(Array.from(e.target.files || [])); }

  private addFiles(list: File[]) {
    this.files.push(...list.filter(f => f.type.startsWith('video/')));
  }

  move(i: number, dir: number) {
    const j = i + dir;
    if (j < 0 || j >= this.files.length) return;
    [this.files[i], this.files[j]] = [this.files[j], this.files[i]];
  }
  remove(i: number) { this.files.splice(i, 1); }

  formatSize(b: number): string {
    if (b < 1024 * 1024) return `${(b / 1024).toFixed(0)} KB`;
    if (b < 1024 * 1024 * 1024) return `${(b / (1024 * 1024)).toFixed(1)} MB`;
    return `${(b / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  }

  async start() {
    if (this.processing || this.files.length < 2) return;
    this.processing = true;
    try {
      const res = await firstValueFrom(this.jobService.createMerge(this.title || 'Merged video', this.files));
      if (res?.job?._id) this.router.navigate(['/processing', res.job._id]);
    } catch (err) {
      console.error('Merge failed:', err);
      this.processing = false;
    }
  }
}
