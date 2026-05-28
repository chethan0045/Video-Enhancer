import { Injectable, inject } from '@angular/core';
import { Socket } from 'ngx-socket-io';
import { Observable } from 'rxjs';

@Injectable({ providedIn: 'root' })
export class WebSocketService {
  private socket = inject(Socket);

  constructor() {
    const token = localStorage.getItem('token');
    if (token) {
      this.socket.emit('authenticate', token);
    }
  }

  onJobProgress(): Observable<any> {
    return this.socket.fromEvent('job:progress');
  }

  onJobUpdate(): Observable<any> {
    return this.socket.fromEvent('job:update');
  }

  subscribeToJob(jobId: string) {
    this.socket.emit('subscribe:job', jobId);
  }

  unsubscribeFromJob(jobId: string) {
    this.socket.emit('unsubscribe:job', jobId);
  }
}
