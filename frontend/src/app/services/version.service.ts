import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

@Injectable({ providedIn: 'root' })
export class VersionService {
  constructor(private http: HttpClient) {}

  getBackendVersion(): Observable<{ version: string }> {
    return this.http.get<{ version: string }>('/api/version');
  }
}
