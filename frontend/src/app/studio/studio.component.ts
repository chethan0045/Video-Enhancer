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
  <div class="studio">
    <!-- Top bar -->
    <header class="topbar">
      <div class="brand"><span class="logo">CineRemaster</span><span class="badge">AI Cinema Engine</span></div>
      <div class="project">{{ videoFile?.name || 'New Project' }}</div>
      <div class="top-actions">
        <button class="btn-ghost" (click)="goBack()">Exit</button>
        <button class="btn-export" (click)="exportProject()" [disabled]="processing || !videoUrl">{{ processing ? 'Exporting…' : '⬇ Export' }}</button>
      </div>
    </header>

    <div class="body">
      <!-- Icon rail -->
      <nav class="rail">
        <button class="r" *ngFor="let s of panels" [class.active]="active===s.key" (click)="active=s.key">
          <span class="ic">{{ s.icon }}</span><span class="lb">{{ s.label }}</span>
        </button>
      </nav>

      <!-- Media library -->
      <section class="media">
        <h4>Media</h4>
        <input #fileInput type="file" accept="video/*" hidden (change)="onFileSelected($event)" />
        <button class="btn-upload" (click)="fileInput.click()">⬆ Upload</button>
        <div class="tabs"><span class="on">All</span><span>Video</span><span>Audio</span><span>Images</span></div>
        <div class="clip" *ngIf="videoUrl" [class.sel]="true">
          <div class="thumb" [style.background-image]="thumbnails[0] ? 'url('+thumbnails[0]+')' : null">
            <span class="dur">{{ formatTime(duration) }}</span><span class="tick">✓</span>
          </div>
          <div class="cn">{{ videoFile?.name || 'video' }}</div>
          <div class="cm">{{ videoWidth }}×{{ videoHeight }}</div>
        </div>
        <div class="media-empty" *ngIf="!videoUrl">No media yet. Click Upload.</div>
      </section>

      <!-- Center: preview + toolbar + timeline -->
      <main class="center">
        <div class="preview-head">{{ videoFile?.name || 'Preview' }}</div>
        <div class="preview" #videoContainer
             (dragover)="onDragOver($event)" (dragleave)="dragging=false" (drop)="onDrop($event)" [class.dragging]="dragging">
          <div *ngIf="!videoUrl" class="empty">
            <div class="ic">🎬</div><h3>Upload a video to start</h3>
            <p>Trim, crop, enhance, clean audio and auto-subtitle — all here.</p>
            <button class="btn-primary" (click)="fileInput.click()">Upload Video</button>
          </div>
          <ng-container *ngIf="videoUrl">
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
          </ng-container>
        </div>

        <div class="transport" *ngIf="videoUrl">
          <span class="tc red">{{ formatTime(currentTime) }}</span>
          <div class="tbtns">
            <button (click)="seekTo(0)">⏮</button><button (click)="seekTo(currentTime-2)">⏪</button>
            <button class="play" (click)="togglePlay()">{{ playing ? '⏸' : '▶' }}</button>
            <button (click)="seekTo(currentTime+2)">⏩</button><button (click)="seekTo(duration)">⏭</button>
          </div>
          <span class="tc">{{ formatTime(duration) }}</span>
          <span class="ar">⛶ {{ videoWidth }}×{{ videoHeight }}</span>
        </div>

        <!-- Toolbar -->
        <div class="toolbar" *ngIf="videoUrl">
          <button (click)="active='trim'">✂<span>Trim</span></button>
          <button (click)="active='crop'">▢<span>Crop</span></button>
          <button (click)="active='subtitles'">▤<span>Subtitle</span></button>
          <button (click)="active='audio'">🔊<span>Audio</span></button>
          <button (click)="active='enhance'">✨<span>Enhance</span></button>
          <button (click)="active='export'">⬇<span>Export</span></button>
        </div>

        <!-- Multi-track timeline -->
        <div class="timeline-area" *ngIf="videoUrl">
          <div class="ruler"><span *ngFor="let m of ticks">{{ m }}</span></div>
          <div class="track">
            <div class="tl-label">▦ Video</div>
            <div class="timeline" #timeline (mousedown)="onTimelineClick($event)">
              <div class="filmstrip"><div class="th" *ngFor="let t of thumbnails" [style.background-image]="t ? 'url('+t+')' : null"></div>
                <div class="th ph" *ngIf="!thumbnails.length">loading…</div></div>
              <div class="dim" [style.left.px]="0" [style.width.%]="pct(trimStart)"></div>
              <div class="dim" [style.left.%]="pct(trimEnd)" [style.right.px]="0"></div>
              <div class="sel" [style.left.%]="pct(trimStart)" [style.width.%]="pct(trimEnd)-pct(trimStart)"></div>
              <div class="handle" [style.left.%]="pct(trimStart)" (mousedown)="onTrimDown($event,'start')"></div>
              <div class="handle" [style.left.%]="pct(trimEnd)" (mousedown)="onTrimDown($event,'end')"></div>
              <div class="playhead" [style.left.%]="pct(currentTime)"></div>
            </div>
          </div>
          <div class="track"><div class="tl-label">▤ Subtitle</div><div class="ghost-track" [class.on]="subs.enabled">{{ subs.enabled ? 'Auto subtitles ('+subs.output+')' : 'Off' }}</div></div>
          <div class="track"><div class="tl-label">♪ Audio</div><div class="ghost-track audio" [class.on]="audio.enabled">{{ audio.enabled ? 'Noise removal on' : (videoFile?.name || 'Audio') }}</div></div>
        </div>
      </main>

      <!-- Properties + AI tools -->
      <aside class="props">
        <div class="ptabs"><span class="on">Video</span><span>Audio</span><span>AI Tools</span></div>

        <div class="psec" *ngIf="active==='media'">
          <h5>Source</h5>
          <div class="kv"><span>File</span><b>{{ videoFile?.name || '—' }}</b></div>
          <div class="kv"><span>Resolution</span><b>{{ videoUrl ? videoWidth+'×'+videoHeight : '—' }}</b></div>
          <div class="kv"><span>Duration</span><b>{{ videoUrl ? formatTime(duration) : '—' }}</b></div>
        </div>

        <div class="psec" *ngIf="active==='trim'">
          <h5>✂ Trim</h5>
          <p class="hint">Drag the handles on the timeline, or set exact times.</p>
          <div class="row2"><label>In<input type="number" step="0.1" [(ngModel)]="trimStart" (change)="clampTrim()"/></label><label>Out<input type="number" step="0.1" [(ngModel)]="trimEnd" (change)="clampTrim()"/></label></div>
          <div class="chips"><button (click)="trimStart=currentTime;clampTrim()">Set In</button><button (click)="trimEnd=currentTime;clampTrim()">Set Out</button><button (click)="resetTrim()">Reset</button></div>
          <div class="meta">Selection: {{ formatTime(trimEnd-trimStart) }}</div>
        </div>

        <div class="psec" *ngIf="active==='crop'">
          <h5>📐 Crop <label class="sw"><input type="checkbox" [(ngModel)]="crop.enabled" (change)="onCropToggle()"/><span></span></label></h5>
          <ng-container *ngIf="crop.enabled">
            <label class="fld">Aspect Ratio<select (change)="applyRatioName($event)"><option *ngFor="let r of ratios" [value]="r.label">{{ r.label }}</option></select></label>
            <div class="row2"><label>X<input type="number" [(ngModel)]="crop.x" (change)="clampCrop()"/></label><label>Y<input type="number" [(ngModel)]="crop.y" (change)="clampCrop()"/></label>
              <label>W<input type="number" [(ngModel)]="crop.width" (change)="clampCrop()"/></label><label>H<input type="number" [(ngModel)]="crop.height" (change)="clampCrop()"/></label></div>
          </ng-container>
        </div>

        <div class="psec" *ngIf="active==='subtitles'">
          <h5>📝 Subtitles <label class="sw"><input type="checkbox" [(ngModel)]="subs.enabled"/><span></span></label></h5>
          <ng-container *ngIf="subs.enabled">
            <p class="hint">Auto-transcribed with Whisper, added on export.</p>
            <label class="fld">Language<select [(ngModel)]="subs.language"><option value="auto">Auto-detect</option><option value="en">English</option><option value="kn">Kannada</option><option value="te">Telugu</option><option value="hi">Hindi</option><option value="ta">Tamil</option></select></label>
            <label class="fld">Accuracy<select [(ngModel)]="subs.model"><option value="tiny">Tiny — fastest</option><option value="base">Base</option><option value="small">Small — best</option></select></label>
            <label class="fld">Output<select [(ngModel)]="subs.output"><option value="burn">Burn into video</option><option value="embed">Embed as track</option><option value="srt">.srt only</option></select></label>
          </ng-container>
        </div>

        <div class="psec" *ngIf="active==='audio'">
          <h5>🎵 Audio <label class="sw"><input type="checkbox" [(ngModel)]="audio.enabled"/><span></span></label></h5>
          <label class="fld" *ngIf="audio.enabled">Noise reduction — {{ audio.strength }}<input type="range" min="0" max="1" step="0.1" [(ngModel)]="audio.strength"/></label>
        </div>

        <div class="psec" *ngIf="active==='enhance'">
          <h5>✨ Enhance <label class="sw"><input type="checkbox" [(ngModel)]="enhance.enabled"/><span></span></label></h5>
          <ng-container *ngIf="enhance.enabled">
            <label class="fld">Resolution<select [(ngModel)]="enhance.target"><option value="1080p">1080p</option><option value="2k">2K</option><option value="4k">4K</option><option value="8k">Super Resolution 8K</option></select></label>
            <label class="fld">Color grade<select [(ngModel)]="enhance.color"><option value="">None</option><option value="cinematic">Cinematic</option><option value="teal_orange">Teal & Orange</option><option value="warm">Warm</option><option value="cool">Cool</option><option value="vintage">Vintage</option></select></label>
            <label class="chk"><input type="checkbox" [(ngModel)]="enhance.denoise"/> Denoise / sharpen</label>
          </ng-container>
        </div>

        <div class="psec" *ngIf="active==='export'">
          <h5>⬇ Export</h5>
          <div class="summary">
            <div [class.on]="hasTrim">✂ Trim {{ hasTrim ? formatTime(trimEnd-trimStart) : 'off' }}</div>
            <div [class.on]="crop.enabled">📐 Crop {{ crop.enabled ? crop.width+'×'+crop.height : 'off' }}</div>
            <div [class.on]="enhance.enabled">✨ Enhance {{ enhance.enabled ? enhance.target : 'off' }}</div>
            <div [class.on]="audio.enabled">🎵 Audio {{ audio.enabled ? 'clean' : 'off' }}</div>
            <div [class.on]="subs.enabled">📝 Subtitles {{ subs.enabled ? subs.output : 'off' }}</div>
          </div>
          <button class="btn-primary full" (click)="exportProject()" [disabled]="processing">{{ processing ? 'Exporting…' : 'Export Video' }}</button>
        </div>

        <!-- AI Tools quick switches -->
        <div class="aitools" *ngIf="videoUrl">
          <h5>AI Tools</h5>
          <div class="ai-grid">
            <button [class.on]="enhance.enabled" (click)="active='enhance';enhance.enabled=true">✨ Enhance Video</button>
            <button [class.on]="subs.enabled" (click)="active='subtitles';subs.enabled=true">📝 Generate Subtitles</button>
            <button [class.on]="audio.enabled" (click)="active='audio';audio.enabled=true">🔇 Remove Noise</button>
            <button [class.on]="enhance.color==='cinematic'" (click)="active='enhance';enhance.enabled=true;enhance.color='cinematic'">🎨 AI Color Grade</button>
            <button [class.on]="enhance.target==='8k'" (click)="active='enhance';enhance.enabled=true;enhance.target='8k'">⬆ Super Resolution 8K</button>
          </div>
        </div>
      </aside>
    </div>
  </div>
  `,
  styles: [`
    :host { --bg:#0a0a0f; --panel:#14141f; --panel2:#16161f; --bd:#232334; --acc:#e94560; --h:#fff; --b:#cfcfe0; --m:#8888aa; }
    .studio { height: 100vh; display: flex; flex-direction: column; background: var(--bg); color: var(--b); font-size: 13px; overflow: hidden; }
    .topbar { display: flex; align-items: center; gap: 16px; padding: 10px 16px; border-bottom: 1px solid var(--bd); background: var(--panel); }
    .brand { display: flex; align-items: center; gap: 8px; }
    .logo { font-weight: 800; background: linear-gradient(135deg,#e94560,#ff6b6b); -webkit-background-clip: text; -webkit-text-fill-color: transparent; }
    .badge { font-size: 10px; padding: 2px 8px; background: #1e1e30; color: var(--m); border-radius: 6px; }
    .project { flex: 1; text-align: center; color: var(--b); }
    .top-actions { display: flex; gap: 8px; }
    .btn-ghost { background: transparent; border: 1px solid var(--bd); color: var(--b); padding: 8px 14px; border-radius: 10px; cursor: pointer; }
    .btn-export { background: linear-gradient(135deg,#e94560,#ff6b6b); border: none; color: #fff; padding: 8px 18px; border-radius: 10px; font-weight: 700; cursor: pointer; }
    .btn-export:disabled { opacity: .5; }
    .btn-primary { background: linear-gradient(135deg,#e94560,#ff6b6b); border: none; color: #fff; padding: 12px 22px; border-radius: 10px; font-weight: 600; cursor: pointer; }
    .btn-primary.full { width: 100%; } .btn-primary:disabled { opacity: .5; }

    .body { flex: 1; display: grid; grid-template-columns: 68px 220px 1fr 290px; min-height: 0; }
    .rail { background: var(--panel); border-right: 1px solid var(--bd); display: flex; flex-direction: column; gap: 2px; padding: 8px 4px; overflow: auto; }
    .rail .r { display: flex; flex-direction: column; align-items: center; gap: 3px; background: transparent; border: none; color: var(--m); padding: 9px 2px; border-radius: 10px; cursor: pointer; }
    .rail .r .ic { font-size: 17px; } .rail .r .lb { font-size: 9px; }
    .rail .r:hover { background: rgba(255,255,255,.04); color: var(--b); }
    .rail .r.active { color: var(--acc); } .rail .r.active .ic { filter: drop-shadow(0 0 6px rgba(233,69,96,.6)); }

    .media { background: var(--panel2); border-right: 1px solid var(--bd); padding: 14px; overflow: auto; }
    .media h4 { color: var(--h); font-size: 14px; margin-bottom: 12px; }
    .btn-upload { width: 100%; background: linear-gradient(135deg,#7c3aed,#a855f7); border: none; color: #fff; padding: 10px; border-radius: 10px; font-weight: 600; cursor: pointer; margin-bottom: 12px; }
    .tabs { display: flex; gap: 14px; font-size: 12px; color: var(--m); border-bottom: 1px solid var(--bd); padding-bottom: 8px; margin-bottom: 12px; }
    .tabs .on { color: var(--acc); border-bottom: 2px solid var(--acc); padding-bottom: 8px; margin-bottom: -9px; }
    .clip { cursor: pointer; }
    .clip .thumb { position: relative; height: 120px; background: #000 center/cover; border-radius: 8px; border: 2px solid var(--acc); }
    .clip .dur { position: absolute; right: 6px; bottom: 6px; background: rgba(0,0,0,.7); padding: 1px 6px; border-radius: 4px; font-size: 11px; color: #fff; }
    .clip .tick { position: absolute; right: 6px; top: 6px; width: 18px; height: 18px; background: var(--acc); border-radius: 50%; color: #fff; font-size: 11px; display: flex; align-items: center; justify-content: center; }
    .clip .cn { color: var(--h); font-size: 12px; margin-top: 8px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .clip .cm { color: var(--m); font-size: 11px; }
    .media-empty { color: var(--m); font-size: 12px; text-align: center; padding: 30px 0; }

    .center { display: flex; flex-direction: column; min-width: 0; min-height: 0; }
    .preview-head { padding: 10px 16px; border-bottom: 1px solid var(--bd); color: var(--b); }
    .preview { position: relative; flex: 1; min-height: 0; background: #000; margin: 12px 16px; border-radius: 10px; overflow: hidden; }
    .preview.dragging { outline: 2px dashed var(--acc); }
    .preview video { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: contain; cursor: pointer; }
    .preview .empty { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; padding: 24px; }
    .preview .empty .ic { font-size: 44px; margin-bottom: 12px; }
    .preview .empty h3 { color: var(--h); font-size: 18px; margin-bottom: 8px; }
    .preview .empty p { color: var(--m); margin-bottom: 18px; }

    .crop-mask { position: absolute; box-shadow: 0 0 0 9999px rgba(0,0,0,.6); pointer-events: none; z-index: 5; }
    .crop-box { position: absolute; border: 1px solid #fff; box-sizing: border-box; cursor: move; z-index: 6; }
    .crop-box .gv { position: absolute; left: 33.3%; right: 33.3%; top: 0; bottom: 0; border-left: 1px solid rgba(255,255,255,.3); border-right: 1px solid rgba(255,255,255,.3); }
    .crop-box .gh { position: absolute; top: 33.3%; bottom: 33.3%; left: 0; right: 0; border-top: 1px solid rgba(255,255,255,.3); border-bottom: 1px solid rgba(255,255,255,.3); }
    .crop-box .hd { position: absolute; width: 12px; height: 12px; background: var(--acc); border: 2px solid #fff; border-radius: 2px; }
    .crop-box .hd.tl{top:-6px;left:-6px;cursor:nwse-resize}.crop-box .hd.tr{top:-6px;right:-6px;cursor:nesw-resize}.crop-box .hd.bl{bottom:-6px;left:-6px;cursor:nesw-resize}.crop-box .hd.br{bottom:-6px;right:-6px;cursor:nwse-resize}
    .crop-box .dim { position: absolute; bottom: 4px; left: 50%; transform: translateX(-50%); font-size: 11px; background: rgba(0,0,0,.7); padding: 2px 6px; border-radius: 3px; }

    .transport { display: flex; align-items: center; gap: 14px; padding: 4px 16px; }
    .transport .tc { color: var(--m); font-variant-numeric: tabular-nums; } .transport .tc.red { color: var(--acc); }
    .tbtns { display: flex; gap: 6px; margin: 0 auto; }
    .tbtns button { width: 34px; height: 30px; border: none; border-radius: 7px; background: #1e1e30; color: #fff; cursor: pointer; }
    .tbtns button.play { background: var(--acc); width: 42px; }
    .ar { color: var(--m); }

    .toolbar { display: flex; gap: 4px; padding: 8px 16px; border-top: 1px solid var(--bd); border-bottom: 1px solid var(--bd); overflow-x: auto; }
    .toolbar button { display: flex; flex-direction: column; align-items: center; gap: 2px; background: transparent; border: none; color: var(--m); padding: 6px 12px; border-radius: 8px; cursor: pointer; font-size: 15px; }
    .toolbar button span { font-size: 10px; }
    .toolbar button:hover { background: rgba(255,255,255,.05); color: var(--b); }

    .timeline-area { padding: 8px 16px 14px; overflow: auto; }
    .ruler { display: flex; justify-content: space-between; color: #555577; font-size: 10px; padding-left: 76px; margin-bottom: 4px; }
    .track { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; }
    .tl-label { width: 68px; flex-shrink: 0; font-size: 11px; color: var(--m); }
    .timeline { position: relative; flex: 1; height: 56px; border-radius: 8px; overflow: hidden; background: #0b0b12; cursor: pointer; user-select: none; }
    .filmstrip { position: absolute; inset: 0; display: flex; }
    .filmstrip .th { flex: 1; background-size: cover; background-position: center; border-right: 1px solid rgba(0,0,0,.4); }
    .filmstrip .ph { display: flex; align-items: center; justify-content: center; color: #555; font-size: 11px; }
    .timeline .dim { position: absolute; top: 0; bottom: 0; background: rgba(10,10,15,.7); pointer-events: none; }
    .timeline .sel { position: absolute; top: 0; bottom: 0; border: 2px solid var(--acc); box-sizing: border-box; pointer-events: none; }
    .timeline .handle { position: absolute; top: 0; bottom: 0; width: 12px; margin-left: -6px; background: var(--acc); border-radius: 3px; cursor: ew-resize; z-index: 3; }
    .timeline .playhead { position: absolute; top: 0; bottom: 0; width: 2px; margin-left: -1px; background: #fff; z-index: 4; pointer-events: none; }
    .ghost-track { flex: 1; height: 34px; border-radius: 8px; background: #161622; display: flex; align-items: center; padding: 0 12px; font-size: 11px; color: var(--m); }
    .ghost-track.audio { background: #11201a; }
    .ghost-track.on { color: var(--h); background: #1e1018; border: 1px solid var(--acc); }

    .props { background: var(--panel2); border-left: 1px solid var(--bd); padding: 14px; overflow: auto; }
    .ptabs { display: flex; gap: 16px; font-size: 12px; color: var(--m); border-bottom: 1px solid var(--bd); padding-bottom: 8px; margin-bottom: 14px; }
    .ptabs .on { color: var(--acc); }
    .psec h5 { color: var(--h); font-size: 13px; margin-bottom: 12px; display: flex; align-items: center; justify-content: space-between; }
    .hint { color: var(--m); font-size: 12px; line-height: 1.4; margin: 0 0 12px; }
    .kv { display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid var(--bd); font-size: 12px; } .kv b { color: var(--h); }
    .row2 { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-bottom: 10px; }
    .row2 label, .fld { display: flex; flex-direction: column; gap: 4px; font-size: 11px; color: var(--m); margin-bottom: 10px; }
    input[type=number], select { background: var(--bg); border: 1px solid var(--bd); border-radius: 8px; padding: 8px; color: var(--h); outline: none; }
    input[type=number]:focus, select:focus { border-color: var(--acc); }
    input[type=range] { accent-color: var(--acc); }
    .chips { display: flex; gap: 6px; margin-bottom: 10px; flex-wrap: wrap; }
    .chips button { background: var(--bg); border: 1px solid var(--bd); color: var(--b); border-radius: 8px; padding: 6px 10px; font-size: 11px; cursor: pointer; }
    .chips button:hover { border-color: var(--acc); color: #fff; }
    .meta { color: var(--acc); font-size: 12px; }
    .chk { display: flex; align-items: center; gap: 8px; color: var(--b); cursor: pointer; }
    .sw { position: relative; width: 38px; height: 20px; } .sw input { display: none; }
    .sw span { position: absolute; inset: 0; background: var(--bd); border-radius: 20px; transition: .2s; }
    .sw span::before { content:''; position: absolute; left: 3px; top: 3px; width: 14px; height: 14px; background: #fff; border-radius: 50%; transition: .2s; }
    .sw input:checked + span { background: var(--acc); } .sw input:checked + span::before { transform: translateX(18px); }
    .summary { display: flex; flex-direction: column; gap: 6px; margin-bottom: 14px; }
    .summary div { color: var(--m); font-size: 12px; padding: 8px 10px; background: var(--bg); border: 1px solid var(--bd); border-radius: 8px; }
    .summary div.on { color: var(--h); border-color: var(--acc); }
    .aitools { margin-top: 18px; border-top: 1px solid var(--bd); padding-top: 14px; }
    .aitools h5 { color: var(--h); font-size: 13px; margin-bottom: 10px; }
    .ai-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
    .ai-grid button { background: var(--bg); border: 1px solid var(--bd); color: var(--b); border-radius: 10px; padding: 12px 8px; font-size: 11px; cursor: pointer; text-align: center; }
    .ai-grid button:hover { border-color: var(--acc); }
    .ai-grid button.on { border-color: var(--acc); color: #fff; background: #1e1018; }
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
  readonly ticks = ['00:00', '00:10', '00:20', '00:30', '00:40', '00:50'];

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
  private loop() { const f = () => { if (this.videoEl && !this.videoEl.paused) { this.currentTime = this.videoEl.currentTime; this.raf = requestAnimationFrame(f); } }; this.raf = requestAnimationFrame(f); }
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
  applyRatioName(e: any) { const r = this.ratios.find(x => x.label === e.target.value); if (r) this.applyRatio(r); }
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
