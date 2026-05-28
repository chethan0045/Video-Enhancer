import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Router } from '@angular/router';
import { Observable, BehaviorSubject, tap } from 'rxjs';
import { environment } from '../../environments/environment';

interface AuthResponse {
  token: string;
  user: { id: string; name: string; email: string; subscription: string };
}

@Injectable({ providedIn: 'root' })
export class AuthService {
  private http = inject(HttpClient);
  private router = inject(Router);
  private userSubject = new BehaviorSubject<any>(null);

  user$ = this.userSubject.asObservable();

  constructor() {
    const token = localStorage.getItem('token');
    const user = localStorage.getItem('user');
    if (token && user) {
      this.userSubject.next(JSON.parse(user));
    }
  }

  login(email: string, password: string): Observable<AuthResponse> {
    return this.http
      .post<AuthResponse>(`${environment.apiUrl}/auth/login`, { email, password })
      .pipe(tap((res) => this.setSession(res)));
  }

  register(name: string, email: string, password: string): Observable<AuthResponse> {
    return this.http
      .post<AuthResponse>(`${environment.apiUrl}/auth/register`, { name, email, password })
      .pipe(tap((res) => this.setSession(res)));
  }

  private setSession(res: AuthResponse) {
    localStorage.setItem('token', res.token);
    localStorage.setItem('user', JSON.stringify(res.user));
    this.userSubject.next(res.user);
  }

  logout() {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    this.userSubject.next(null);
    this.router.navigate(['/auth']);
  }

  isAuthenticated(): boolean {
    return !!localStorage.getItem('token');
  }

  getUser() {
    return this.userSubject.value;
  }
}
