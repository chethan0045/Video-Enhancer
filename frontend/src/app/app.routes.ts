import { Routes } from '@angular/router';
import { authGuard } from './core/auth.guard';

export const routes: Routes = [
  { path: '', redirectTo: '/dashboard', pathMatch: 'full' },
  {
    path: 'auth',
    loadChildren: () => import('./auth/auth.routes').then((m) => m.authRoutes),
  },
  {
    path: 'dashboard',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./dashboard/dashboard.component').then((m) => m.DashboardComponent),
  },
  {
    path: 'upload',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./upload/upload.component').then((m) => m.UploadComponent),
  },
  {
    path: 'processing/:id',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./processing/processing.component').then((m) => m.ProcessingComponent),
  },
  {
    path: 'preview/:id',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./preview/preview.component').then((m) => m.PreviewComponent),
  },
  {
    path: 'settings',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./settings/settings.component').then((m) => m.SettingsComponent),
  },
  {
    path: 'editor',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./editor/editor.component').then((m) => m.EditorComponent),
  },
  {
    path: 'editor/:id',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./editor/editor.component').then((m) => m.EditorComponent),
  },
  { path: '**', redirectTo: '/dashboard' },
];
