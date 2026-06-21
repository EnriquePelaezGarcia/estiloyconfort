import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiService } from './api.service';
import { User } from '../models/user.model';
import {
  CreateUserRequest,
  DashboardStats,
  Role,
  UpdateUserRequest,
} from '../models/admin.model';

@Injectable({ providedIn: 'root' })
export class AdminService {
  private api = inject(ApiService);

  // ===== Dashboard =====
  getDashboard(): Observable<DashboardStats> {
    return this.api.get<DashboardStats>('/admin/dashboard');
  }

  // ===== Roles =====
  getRoles(): Observable<Role[]> {
    return this.api.get<Role[]>('/roles');
  }

  // ===== Usuarios =====
  getUsers(): Observable<User[]> {
    return this.api.get<User[]>('/users');
  }

  createUser(payload: CreateUserRequest): Observable<User> {
    return this.api.post<User>('/users', payload);
  }

  updateUser(id: number, payload: UpdateUserRequest): Observable<User> {
    return this.api.patch<User>(`/users/${id}`, payload);
  }

  toggleUserStatus(id: number): Observable<User> {
    return this.api.patch<User>(`/users/${id}/toggle-status`, {});
  }

  deleteUser(id: number): Observable<void> {
    return this.api.delete<void>(`/users/${id}`);
  }
}
