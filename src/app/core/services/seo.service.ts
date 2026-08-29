import { DOCUMENT } from '@angular/common';
import { Injectable, inject } from '@angular/core';
import { Meta, Title } from '@angular/platform-browser';
import { environment } from '../../../environments/environment';
import { Product } from '../models/product.model';
import { mediaUrl } from '../utils/media-url';

/**
 * SEO por página (Docs/plan-imagen-y-ayuda-por-material.md, Parte 3).
 *
 * La app es SSR (@angular/ssr): `Title`/`Meta` puestos aquí desde el
 * `subscribe` de la carga de datos SÍ llegan al HTML servido y al preview de
 * WhatsApp/Facebook. Antes de esto no se usaba `Title`/`Meta` en ningún lado
 * y la ruta `producto/:slug` tenía un `<title>` estático genérico.
 *
 * `og:image` sale de `mediaUrl()`, que ya devuelve una URL absoluta al API
 * (donde viven las fotos). El resto de las URLs (canonical, og:url) usan
 * `environment.siteUrl`, el origen del sitio público.
 */

const SITE_NAME = 'Mueblería Estilo y Confort';
const DEFAULT_TITLE = 'Mueblería Estilo y Confort';
const DEFAULT_DESC =
  'Muebles de recámara, tocadores, roperos, camas y más. Fabricación a medida y envío a domicilio en Puebla.';

interface MetaInput {
  title: string;
  description: string;
  image: string;
  url: string;
  type: 'website' | 'product';
}

@Injectable({ providedIn: 'root' })
export class SeoService {
  private readonly title = inject(Title);
  private readonly meta = inject(Meta);
  private readonly doc = inject(DOCUMENT);

  private readonly siteUrl = environment.siteUrl.replace(/\/+$/, '');
  private readonly fallbackImage = `${this.siteUrl}/icon-192.png`;

  /** Ficha de producto: title, meta, OpenGraph, Twitter, canonical y JSON-LD. */
  setProduct(product: Product): void {
    const title = `${product.name} — ${SITE_NAME}`;
    const description = this.buildDescription(product);
    const image = this.productImage(product);
    const url = `${this.siteUrl}/producto/${product.slug}`;

    this.apply({ title, description, image, url, type: 'product' });
    this.setJsonLd(this.productJsonLd(product, url, image, description));
  }

  /** Páginas simples (catálogo, nosotros, contacto). Agrega la description que la ruta no da. */
  setBasic(pageTitle: string, description?: string, path?: string): void {
    const url = `${this.siteUrl}${path ?? this.currentPath()}`;
    this.apply({
      title: `${pageTitle} — ${SITE_NAME}`,
      description: description ?? DEFAULT_DESC,
      image: this.fallbackImage,
      url,
      type: 'website',
    });
    this.removeJsonLd();
  }

  /** Vuelve a los valores por defecto del sitio. Se llama al salir de una página con SEO propio. */
  reset(): void {
    this.apply({
      title: DEFAULT_TITLE,
      description: DEFAULT_DESC,
      image: this.fallbackImage,
      url: this.siteUrl,
      type: 'website',
    });
    this.removeJsonLd();
  }

  // ===== internos =====

  private apply(o: MetaInput): void {
    this.title.setTitle(o.title);
    this.meta.updateTag({ name: 'description', content: o.description });
    this.meta.updateTag({ property: 'og:title', content: o.title });
    this.meta.updateTag({ property: 'og:description', content: o.description });
    this.meta.updateTag({ property: 'og:type', content: o.type });
    this.meta.updateTag({ property: 'og:image', content: o.image });
    this.meta.updateTag({ property: 'og:url', content: o.url });
    this.meta.updateTag({ property: 'og:site_name', content: SITE_NAME });
    this.meta.updateTag({ property: 'og:locale', content: 'es_MX' });
    this.meta.updateTag({ name: 'twitter:card', content: 'summary_large_image' });
    this.meta.updateTag({ name: 'twitter:title', content: o.title });
    this.meta.updateTag({ name: 'twitter:description', content: o.description });
    this.meta.updateTag({ name: 'twitter:image', content: o.image });
    this.setCanonical(o.url);
  }

  private setCanonical(url: string): void {
    let link = this.doc.head.querySelector<HTMLLinkElement>('link[rel="canonical"]');
    if (!link) {
      link = this.doc.createElement('link');
      link.setAttribute('rel', 'canonical');
      this.doc.head.appendChild(link);
    }
    link.setAttribute('href', url);
  }

  private currentPath(): string {
    try {
      return this.doc.location?.pathname ?? '/';
    } catch {
      return '/';
    }
  }

  /**
   * URL absoluta de la foto para OG/JSON-LD. `findById` (la ficha) no trae
   * `primary_image` — esa columna solo la calcula `findAll` — así que se cae a
   * la galería: la principal, o la primera.
   */
  private productImage(p: Product): string {
    const fromImages = p.images?.find((i) => i.is_primary)?.image_url ?? p.images?.[0]?.image_url;
    return mediaUrl(p.primary_image ?? fromImages) ?? this.fallbackImage;
  }

  private buildDescription(p: Product): string {
    const raw = (p.description ?? '').trim().replace(/\s+/g, ' ');
    if (raw) return raw.length > 155 ? `${raw.slice(0, 152).trimEnd()}…` : raw;
    const cat = p.category_name ? ` — ${p.category_name.toLowerCase()}` : '';
    return `${p.name}${cat}. Fabricación a medida y envío a domicilio en Puebla. Cotiza por WhatsApp.`;
  }

  private productJsonLd(
    p: Product,
    url: string,
    image: string,
    description: string,
  ): Record<string, unknown> {
    // Sin `availability` a propósito (Docs/plan-imagen-y-ayuda-por-material.md):
    // el negocio no anuncia existencia al cliente.
    const offer: Record<string, unknown> = { '@type': 'Offer', priceCurrency: 'MXN', url };
    if (p.price_from != null) offer['price'] = Number(p.price_from);

    return {
      '@context': 'https://schema.org',
      '@type': 'Product',
      name: p.name,
      image: [image],
      description,
      ...(p.sku ? { sku: p.sku } : {}),
      brand: { '@type': 'Brand', name: 'Estilo y Confort' },
      offers: offer,
    };
  }

  private setJsonLd(data: Record<string, unknown>): void {
    this.removeJsonLd();
    const script = this.doc.createElement('script');
    script.setAttribute('type', 'application/ld+json');
    script.id = 'ld-product';
    script.textContent = JSON.stringify(data);
    this.doc.head.appendChild(script);
  }

  private removeJsonLd(): void {
    this.doc.getElementById('ld-product')?.remove();
  }
}
