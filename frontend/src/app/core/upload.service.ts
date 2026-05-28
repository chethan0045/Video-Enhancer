import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';

@Injectable({ providedIn: 'root' })
export class UploadService {
  private http = inject(HttpClient);

  uploadVideo(file: File): Observable<any> {
    const formData = new FormData();
    formData.append('video', file);
    return this.http.post(`${environment.apiUrl}/upload`, formData);
  }
}
