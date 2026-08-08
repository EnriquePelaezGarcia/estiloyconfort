import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { ApiService } from './api.service';
import { Category } from '../models/category.model';
import {
  Product,
  ProductFilters,
  ProductImage,
  ProductListResponse,
  ProductManufacturerPricesResponse,
  ProductPayload,
} from '../models/product.model';

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

  // ===== Administración (Fase 3) =====

  /** Listado para el panel admin: incluye productos inactivos y trae todo el catálogo. */
  getProductsAdmin(): Observable<Product[]> {
    return this.api
      .get<ProductListResponse>('/products', { includeInactive: 'true', limit: '500' })
      .pipe(map(r => r.data));
  }

  createProduct(payload: ProductPayload): Observable<Product> {
    return this.api.post<{ data: Product }>('/products', payload).pipe(map(r => r.data));
  }

  updateProduct(id: number, payload: Partial<ProductPayload>): Observable<Product> {
    return this.api.patch<{ data: Product }>(`/products/${id}`, payload).pipe(map(r => r.data));
  }

  deleteProduct(id: number): Observable<void> {
    return this.api.delete<void>(`/products/${id}`);
  }

  // ===== Imágenes =====

  uploadProductImage(productId: number, file: File, altText?: string): Observable<ProductImage> {
    const fd = new FormData();
    fd.append('image', file);
    if (altText) fd.append('alt_text', altText);
    return this.api
      .postFormData<{ data: ProductImage }>(`/products/${productId}/images`, fd)
      .pipe(map(r => r.data));
  }

  deleteProductImage(productId: number, imageId: number): Observable<void> {
    return this.api.delete<void>(`/products/${productId}/images/${imageId}`);
  }

  setPrimaryImage(productId: number, imageId: number): Observable<ProductImage> {
    return this.api
      .patch<{ data: ProductImage }>(`/products/${productId}/images/${imageId}`, { is_primary: true })
      .pipe(map(r => r.data));
  }

  // ===== Costos por fabricante =====

  getManufacturerPrices(productId: number): Observable<ProductManufacturerPricesResponse> {
    return this.api.get<ProductManufacturerPricesResponse>(
      `/products/${productId}/manufacturer-prices`,
    );
  }

  /**
   * Fija el costo de un fabricante. El backend recalcula el costo base (el
   * máximo de todos los fabricantes) y reprecia el producto.
   *
   * Con `affectsBaseCost` en false el costo queda fuera de ese máximo: sirve
   * para asignar y para la utilidad real, pero no mueve el precio al público.
   */
  setManufacturerPrice(
    productId: number,
    manufacturerId: number,
    cost: number,
    affectsBaseCost = true,
  ): Observable<ProductManufacturerPricesResponse> {
    return this.api.put<ProductManufacturerPricesResponse>(
      `/products/${productId}/manufacturer-prices/${manufacturerId}`,
      { cost, affectsBaseCost },
    );
  }

  removeManufacturerPrice(
    productId: number,
    manufacturerId: number,
  ): Observable<ProductManufacturerPricesResponse> {
    return this.api.delete<ProductManufacturerPricesResponse>(
      `/products/${productId}/manufacturer-prices/${manufacturerId}`,
    );
  }
}
