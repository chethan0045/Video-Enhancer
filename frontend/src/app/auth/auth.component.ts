import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { AuthService } from '../core/auth.service';

@Component({
  selector: 'app-auth',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="auth-container">
      <div class="auth-card">
        <div class="logo">
          <span class="logo-icon">🎬</span>
          <h1>CineRemaster</h1>
          <p class="subtitle">AI Cinematic Video Enhancement</p>
        </div>

        <div class="tabs">
          <button [class.active]="!isRegister" (click)="isRegister = false">Login</button>
          <button [class.active]="isRegister" (click)="isRegister = true">Register</button>
        </div>

        <form (ngSubmit)="onSubmit()" class="auth-form">
          <div *ngIf="isRegister" class="field">
            <label>Name</label>
            <input type="text" [(ngModel)]="name" name="name" placeholder="Your name" required />
          </div>
          <div class="field">
            <label>Email</label>
            <input type="email" [(ngModel)]="email" name="email" placeholder="you@example.com" required />
          </div>
          <div class="field">
            <label>Password</label>
            <input type="password" [(ngModel)]="password" name="password" placeholder="Min 8 characters" required />
          </div>

          <div *ngIf="error" class="error">{{ error }}</div>

          <button type="submit" class="btn-primary" [disabled]="loading">
            {{ loading ? 'Please wait...' : isRegister ? 'Create Account' : 'Sign In' }}
          </button>
        </form>
      </div>
    </div>
  `,
  styles: [`
    .auth-container {
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      background: linear-gradient(135deg, #0a0a0f 0%, #1a1a2e 50%, #0a0a0f 100%);
    }
    .auth-card {
      background: #14141f;
      border: 1px solid #2a2a3e;
      border-radius: 24px;
      padding: 48px;
      width: 420px;
      max-width: 90vw;
    }
    .logo { text-align: center; margin-bottom: 32px; }
    .logo-icon { font-size: 48px; }
    .logo h1 {
      margin: 8px 0 4px;
      font-size: 28px;
      font-weight: 700;
      background: linear-gradient(135deg, #e94560, #ff6b6b);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
    }
    .subtitle { color: #8888aa; font-size: 13px; }
    .tabs { display: flex; gap: 8px; margin-bottom: 24px; background: #1e1e30; border-radius: 12px; padding: 4px; }
    .tabs button {
      flex: 1;
      padding: 10px;
      border: none;
      background: transparent;
      color: #8888aa;
      cursor: pointer;
      border-radius: 8px;
      font-size: 14px;
      font-weight: 500;
      transition: all 0.2s;
    }
    .tabs button.active { background: #e94560; color: white; }
    .auth-form { display: flex; flex-direction: column; gap: 16px; }
    .field { display: flex; flex-direction: column; gap: 6px; }
    .field label { font-size: 13px; color: #aaaacc; font-weight: 500; }
    .field input {
      background: #1a1a2e;
      border: 1px solid #2a2a3e;
      border-radius: 10px;
      padding: 12px 16px;
      color: white;
      font-size: 14px;
      outline: none;
      transition: border 0.2s;
    }
    .field input:focus { border-color: #e94560; }
    .field input::placeholder { color: #555577; }
    .btn-primary {
      padding: 14px;
      background: linear-gradient(135deg, #e94560, #ff6b6b);
      border: none;
      border-radius: 12px;
      color: white;
      font-size: 15px;
      font-weight: 600;
      cursor: pointer;
      transition: opacity 0.2s;
      margin-top: 8px;
    }
    .btn-primary:disabled { opacity: 0.5; cursor: not-allowed; }
    .btn-primary:not(:disabled):hover { opacity: 0.9; }
    .error { color: #ff6b6b; font-size: 13px; text-align: center; padding: 8px; background: #2a1515; border-radius: 8px; }
  `],
})
export class AuthComponent {
  private auth = inject(AuthService);
  private router = inject(Router);

  isRegister = false;
  name = '';
  email = '';
  password = '';
  loading = false;
  error = '';

  async onSubmit() {
    this.loading = true;
    this.error = '';
    try {
      if (this.isRegister) {
        await firstValueFrom(this.auth.register(this.name, this.email, this.password));
      } else {
        await firstValueFrom(this.auth.login(this.email, this.password));
      }
      this.router.navigate(['/dashboard']);
    } catch (err: any) {
      console.error('[Auth] Error:', err);
      if (err.error?.error) {
        this.error = err.error.error;
      } else if (err.error?.errors?.[0]?.msg) {
        this.error = err.error.errors[0].msg;
      } else if (err.message) {
        this.error = err.message;
      } else if (typeof err.error === 'string') {
        this.error = err.error;
      } else {
        this.error = `Connection failed — is the backend running on port 5000?`;
      }
    } finally {
      this.loading = false;
    }
  }
}
