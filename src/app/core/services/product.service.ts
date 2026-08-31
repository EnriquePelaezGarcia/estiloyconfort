import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { ApiService } from './api.service';
import { Category } from '../models/category.model';
import {
  Product,
  ProductDeclaredMaterial,
  ProductDeclaredSize,
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

  getProduct(idOrSlug: string | number, includeInactive = false): Observable<Product> {
    return this.api
      .get<{ data: Product }>(`/products/${idOrSlug}`, includeInactive ? { includeInactive: 'true' } : undefined)
      .pipe(map(r => r.data));
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

  /**
   * Borrado permanente (para productos de prueba). El backend lo rechaza con
   * 409 si el producto ya aparece en pedidos, cotizaciones u órdenes de compra.
   */
  deleteProductPermanent(id: number): Observable<void> {
    return this.api.delete<void>(`/products/${id}?permanent=true`);
  }

  // ===== Imágenes =====

  uploadProductImage(
    productId: number,
    file: File,
    opts: { altText?: string; materialId?: number | null } = {},
  ): Observable<ProductImage> {
    const fd = new FormData();
    fd.append('image', file);
    if (opts.altText) fd.append('alt_text', opts.altText);
    if (opts.materialId != null) fd.append('material_id', String(opts.materialId));
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

  /**
   * Actualiza el material que representa una imagen y/o su texto alternativo
   * (Docs/plan-imagen-y-ayuda-por-material.md, Parte 2). `materialId: null` la
   * vuelve genérica.
   */
  setImageMeta(
    productId: number,
    imageId: number,
    patch: { materialId?: number | null; altText?: string },
  ): Observable<ProductImage> {
    const body: Record<string, unknown> = {};
    if ('materialId' in patch) body['material_id'] = patch.materialId ?? '';
    if ('altText' in patch) body['alt_text'] = patch.altText ?? '';
    return this.api
      .patch<{ data: ProductImage }>(`/products/${productId}/images/${imageId}`, body)
      .pipe(map(r => r.data));
  }

  // ===== Materiales declarados del producto (M2) =====

  getProductMaterials(productId: number): Observable<ProductDeclaredMaterial[]> {
    return this.api
      .get<{ data: ProductDeclaredMaterial[] }>(`/products/${productId}/materials`)
      .pipe(map((r) => r.data));
  }

  setProductMaterials(productId: number, materialIds: number[]): Observable<ProductDeclaredMaterial[]> {
    return this.api
      .put<{ data: ProductDeclaredMaterial[] }>(`/products/${productId}/materials`, { materialIds })
      .pipe(map((r) => r.data));
  }

  // ===== Tallas declaradas del producto (Docs/plan-productos-por-tamano.md — D2) =====

  getProductSizes(productId: number): Observable<ProductDeclaredSize[]> {
    return this.api
      .get<{ data: ProductDeclaredSize[] }>(`/products/${productId}/sizes`)
      .pipe(map((r) => r.data));
  }

  setProductSizes(productId: number, sizeIds: number[]): Observable<ProductDeclaredSize[]> {
    return this.api
      .put<{ data: ProductDeclaredSize[] }>(`/products/${productId}/sizes`, { sizeIds })
      .pipe(map((r) => r.data));
  }

  // ===== Costos por fabricante × material × talla, en filas (M3 + D3) =====

  getManufacturerPrices(productId: number): Observable<ProductManufacturerPricesResponse> {
    return this.api.get<ProductManufacturerPricesResponse>(
      `/products/${productId}/manufacturer-costs`,
    );
  }

  /**
   * Fija los costos de un fabricante, uno por material DECLARADO (M2), sin
   * relación aritmética entre ellos. `cost: null` explícito en un material =
   * "este fabricante no hace el mueble en ese material" (RN-03) — borra la
   * fila. El backend recalcula el costo base POR MATERIAL (el máximo de
   * todos los fabricantes) y reprecia el producto en cada uno.
   *
   * Con `affectsBaseCost` en false ESE costo queda fuera del máximo de ESE
   * material: sirve para asignar y para la utilidad real, pero no mueve el
   * precio al público (M3, más fino que antes: era por producto × fabricante).
   */
  setManufacturerPrice(
    productId: number,
    manufacturerId: number,
    costs: Array<{ materialId: number; sizeId?: number; cost: number | null; affectsBaseCost?: boolean }>,
  ): Observable<ProductManufacturerPricesResponse> {
    return this.api.put<ProductManufacturerPricesResponse>(
      `/products/${productId}/manufacturer-costs/${manufacturerId}`,
      { costs },
    );
  }

  removeManufacturerPrice(
    productId: number,
    manufacturerId: number,
  ): Observable<ProductManufacturerPricesResponse> {
    return this.api.delete<ProductManufacturerPricesResponse>(
      `/products/${productId}/manufacturer-costs/${manufacturerId}`,
    );
  }
}
