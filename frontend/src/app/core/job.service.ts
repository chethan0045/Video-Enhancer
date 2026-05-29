import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';

export interface VideoJob {
  _id: string;
  userId: string;
  title: string;
  mode?: 'enhance' | 'edit';
  inputPath: string;
  outputPath?: string;
  status: string;
  progress: number;
  pipeline: any;
  pipelineStages: any[];
  error?: string;
  createdAt: string;
  updatedAt: string;
  inputDuration?: number;
  inputResolution?: { width: number; height: number };
  thumbnailPath?: string;
}

@Injectable({ providedIn: 'root' })
export class JobService {
  private http = inject(HttpClient);

  list(page = 1, status?: string): Observable<{ jobs: VideoJob[]; pagination: any }> {
    let params = `?page=${page}&limit=20`;
    if (status) params += `&status=${status}`;
    return this.http.get<any>(`${environment.apiUrl}/jobs${params}`);
  }

  get(id: string): Observable<{ job: VideoJob }> {
    return this.http.get<any>(`${environment.apiUrl}/jobs/${id}`);
  }

  create(title: string, settings: any, file?: File, mode: 'enhance' | 'edit' = 'enhance'): Observable<{ job: VideoJob }> {
    const formData = new FormData();
    formData.append('video', file!);
    formData.append('title', title);
    formData.append('mode', mode);
    formData.append('settings', JSON.stringify(settings));
    return this.http.post<any>(`${environment.apiUrl}/jobs`, formData);
  }

  cancel(id: string): Observable<{ job: VideoJob }> {
    return this.http.put<any>(`${environment.apiUrl}/jobs/${id}/cancel`, {});
  }

  retry(id: string): Observable<{ job: VideoJob }> {
    return this.http.put<any>(`${environment.apiUrl}/jobs/${id}/retry`, {});
  }

  delete(id: string): Observable<any> {
    return this.http.delete(`${environment.apiUrl}/jobs/${id}`);
  }

  updatePipeline(id: string, pipeline: any): Observable<any> {
    return this.http.put(`${environment.apiUrl}/jobs/${id}/pipeline`, { pipeline });
  }
}
