import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { AuthService } from '../core/auth.service';

@Component({
  selector: 'app-settings',
  standalone: true,
  imports: [CommonModule, RouterLink],
  template: `
    <div class="settings-page">
      <header class="header">
        <button class="btn-back" routerLink="/dashboard">← Back</button>
        <h1>Settings</h1>
      </header>

      <div class="content">
        <div class="section">
          <h3>Account</h3>
          <div class="info-row">
            <span class="label">Name</span>
            <span class="value">{{ user?.name }}</span>
          </div>
          <div class="info-row">
            <span class="label">Email</span>
            <span class="value">{{ user?.email }}</span>
          </div>
          <div class="info-row">
            <span class="label">Plan</span>
            <span class="value plan-badge">{{ user?.subscription }}</span>
          </div>
        </div>

        <div class="section">
          <h3>Storage</h3>
          <div class="storage-bar">
            <div class="storage-fill" style="width: 0%"></div>
          </div>
          <p class="storage-text">0 GB / 5 GB used</p>
        </div>

        <div class="section">
          <h3>GPU Acceleration</h3>
          <div class="info-row">
            <span class="label">CUDA</span>
            <span class="value status-active">Available</span>
          </div>
          <div class="info-row">
            <span class="label">TensorRT</span>
            <span class="value status-active">Available</span>
          </div>
        </div>

        <div class="section">
          <h3>Supported Models</h3>
          <div class="model-list">
            <div class="model-item">
              <span>Real-ESRGAN</span><span class="tag">Upscale</span>
            </div>
            <div class="model-item">
              <span>BasicVSR++</span><span class="tag">Temporal</span>
            </div>
            <div class="model-item">
              <span>CodeFormer</span><span class="tag">Face</span>
            </div>
            <div class="model-item">
              <span>Restormer</span><span class="tag">Deblur</span>
            </div>
            <div class="model-item">
              <span>RIFE</span><span class="tag">Interpolation</span>
            </div>
            <div class="model-item">
              <span>MiDaS</span><span class="tag">Depth</span>
            </div>
          </div>
        </div>

        <button class="btn-logout" (click)="auth.logout()">Logout</button>
      </div>
    </div>
  `,
  styles: [`
    .settings-page { min-height: 100vh; background: #0a0a0f; color: white; }
    .header {
      display: flex; align-items: center; gap: 16px; padding: 16px 32px;
      border-bottom: 1px solid #1a1a2e;
    }
    .header h1 { font-size: 18px; font-weight: 600; }
    .btn-back { background: transparent; border: 1px solid #2a2a3e; color: #8888aa; padding: 8px 16px; border-radius: 8px; cursor: pointer; }
    .content { max-width: 600px; margin: 0 auto; padding: 32px; }
    .section {
      background: #14141f; border: 1px solid #1e1e30;
      border-radius: 16px; padding: 20px; margin-bottom: 16px;
    }
    .section h3 { font-size: 14px; font-weight: 600; margin-bottom: 16px; color: #aaaacc; }
    .info-row { display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid #1a1a2e; }
    .info-row:last-child { border-bottom: none; }
    .label { color: #8888aa; font-size: 14px; }
    .value { font-weight: 500; }
    .plan-badge {
      background: #1a1a3e; color: #8888ff; padding: 2px 10px;
      border-radius: 20px; font-size: 12px; text-transform: capitalize;
    }
    .status-active { color: #66cc66; font-size: 13px; }
    .storage-bar { height: 8px; background: #1e1e30; border-radius: 4px; overflow: hidden; margin-bottom: 8px; }
    .storage-fill { height: 100%; background: linear-gradient(90deg, #e94560, #ff6b6b); border-radius: 4px; }
    .storage-text { font-size: 12px; color: #8888aa; }
    .model-list { display: flex; flex-direction: column; gap: 6px; }
    .model-item { display: flex; justify-content: space-between; padding: 8px 12px; background: #1a1a2e; border-radius: 8px; font-size: 13px; }
    .tag { font-size: 11px; padding: 2px 8px; background: #2a2a4e; border-radius: 4px; color: #8888ff; }
    .btn-logout {
      width: 100%; padding: 14px; margin-top: 8px;
      background: transparent; border: 1px solid #2e1515;
      border-radius: 12px; color: #ff6666; font-size: 14px; font-weight: 500; cursor: pointer;
    }
  `],
})
export class SettingsComponent {
  auth = inject(AuthService);
  user = this.auth.getUser();
}
