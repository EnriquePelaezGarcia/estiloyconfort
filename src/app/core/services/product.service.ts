import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { ApiService } from './api.service';
import { Category } from '../models/category.model';
import { Product, ProductFilters, ProductListResponse } from '../models/product.model';

@Injectable({ providedIn: 'root' })
export class ProductService {
  private api = inject(ApiService);

  getProducts(filters: ProductFilters = {}): Observable<ProductListResponse> {
    const params: Record<string, string> = {};
    if (filters.category) params['category'] = filters.category;
    if (filters.search) params['search'] = filters.search;
    if (filters.minPrice !== undefined) params['minPrice'] = String(filters.minPrice);
    if (filters.maxPrice !== undefined) params['maxPrice'] = String(filters.maxPrice);
    if (filters.featured !== undefined) params['featured'] = String(filters.featured);
    if (filters.page) params['page'] = String(filters.page);
    if (filters.limit) params['limit'] = String(filters.limit);
    if (filters.sort) params['sort'] = filters.sort;
    return this.api.get<ProductListResponse>('/products', params);
  }

  getProduct(idOrSlug: string | number): Observable<Product> {
    return this.api.get<{ data: Product }>(`/products/${idOrSlug}`).pipe(
      map(r => r.data)
    );
  }

  search(q: string): Observable<Product[]> {
    return this.api.get<{ data: Product[] }>('/products/search', { q }).pipe(
      map(r => r.data)
    );
  }

  getCategories(): Observable<Category[]> {
    return this.api.get<{ data: Category[] }>('/categories').pipe(
      map(r => r.data)
    );
  }
}
