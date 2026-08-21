import { Injectable, inject } from '@angular/core';
import { Observable, map } from 'rxjs';
import { ApiService } from './api.service';
import { Category, CategoryPayload } from '../models/category.model';

@Injectable({ providedIn: 'root' })
export class CategoryService {
  private api = inject(ApiService);

  /** Listado público: solo activas. */
  getAll(): Observable<Category[]> {
    return this.api.get<{ data: Category[] }>('/categories').pipe(map((r) => r.data));
  }

  /** Listado del panel: incluye las desactivadas. */
  getAllAdmin(): Observable<Category[]> {
    return this.api.get<{ data: Category[] }>('/categories/admin').pipe(map((r) => r.data));
  }

  create(payload: CategoryPayload): Observable<Category> {
    return this.api.post<{ data: Category }>('/categories', payload).pipe(map((r) => r.data));
  }

  update(id: number, payload: Partial<CategoryPayload>): Observable<Category> {
    return this.api.patch<{ data: Category }>(`/categories/${id}`, payload).pipe(map((r) => r.data));
  }

  remove(id: number): Observable<void> {
    return this.api.delete<void>(`/categories/${id}`);
  }

  uploadImage(id: number, file: File): Observable<Category> {
    const fd = new FormData();
    fd.append('image', file);
    return this.api
      .postFormData<{ data: Category }>(`/categories/${id}/image`, fd)
      .pipe(map((r) => r.data));
  }

  deleteImage(id: number): Observable<Category> {
    return this.api.delete<{ data: Category }>(`/categories/${id}/image`).pipe(map((r) => r.data));
  }
}
