import { Injectable, inject } from '@angular/core';
import { NavigationEnd, Router } from '@angular/router';
import { filter } from 'rxjs';

/**
 * Traspaso del borrador cuando el vendedor sale un momento del punto de venta
 * o del builder de cotizaciones a ver la ficha pública de un producto
 * (/producto/:slug) y regresa.
 *
 * Hace falta porque ni el `OrderDraftStore` ni `QuoteCreateComponent`
 * sobreviven a la navegación: el store se provee en el componente
 * (`providers: [OrderDraftStore]`) y muere con la pantalla — a propósito, para
 * que un borrador nunca se filtre a otro pedido. Aquí se guarda una foto del
 * borrador SOLO durante ese viaje de ida y vuelta.
 *
 * Se persiste en `sessionStorage` para aguantar un F5 en la ficha, y muere con
 * la pestaña. Se descarta sola si el vendedor se va a cualquier otro lado
 * (menú, dashboard…): así una foto vieja nunca reaparece en un pedido nuevo.
 */

const STORAGE_KEY = 'eyc_draft_handoff';

/** Un borrador olvidado deja de restaurarse pasado este tiempo. */
const TTL_MS = 30 * 60_000;

/** Qué pantalla dejó la foto — un borrador de pedido no se restaura en cotizaciones. */
export type DraftContext = 'order' | 'quote';

interface StoredHandoff {
  context: DraftContext;
  /** URL exacta de regreso, con sus query params (?paso, ?edit, ?fromQuote…). */
  returnUrl: string;
  savedAt: number;
  state: unknown;
}

/** Ruta base de la ficha pública: navegar dentro de ella no descarta la foto. */
const PRODUCT_PATH = '/producto/';

/** Compara solo la ruta, sin query params: `?paso=entrega` no cambia de pantalla. */
function pathOf(url: string): string {
  return url.split('?')[0].split('#')[0];
}

@Injectable({ providedIn: 'root' })
export class DraftHandoffService {
  private router = inject(Router);

  constructor() {
    // Abandono: el vendedor se fue de la ficha a cualquier sitio que no sea la
    // pantalla de la que salió. Lo capturado ya no le sirve a nadie y dejarlo
    // guardado solo arriesga restaurarlo encima de un borrador nuevo.
    this.router.events
      .pipe(filter((e): e is NavigationEnd => e instanceof NavigationEnd))
      .subscribe((e) => {
        const stored = this.read();
        if (!stored) return;
        const path = pathOf(e.urlAfterRedirects);
        if (path.startsWith(PRODUCT_PATH) || path === pathOf(stored.returnUrl)) return;
        this.discard();
      });
  }

  /** Guarda la foto del borrador antes de salir a la ficha del producto. */
  stash(context: DraftContext, returnUrl: string, state: unknown): void {
    const payload: StoredHandoff = { context, returnUrl, savedAt: Date.now(), state };
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    } catch {
      /* sin sessionStorage (SSR) o lleno: se pierde el borrador, no la app */
    }
  }

  /**
   * Recupera y CONSUME la foto si es de esta pantalla y no venció. Devuelve
   * null cuando la pantalla se abrió normal, que es el caso habitual.
   */
  take<T>(context: DraftContext, currentUrl: string): T | null {
    const stored = this.read();
    if (!stored) return null;
    if (stored.context !== context) return null;
    if (pathOf(stored.returnUrl) !== pathOf(currentUrl)) return null;
    if (Date.now() - stored.savedAt > TTL_MS) {
      this.discard();
      return null;
    }
    this.discard();
    return stored.state as T;
  }

  /** URL de regreso pendiente, para el botón "Volver" de la ficha. */
  pendingReturnUrl(): string | null {
    const stored = this.read();
    if (!stored) return null;
    if (Date.now() - stored.savedAt > TTL_MS) {
      this.discard();
      return null;
    }
    return stored.returnUrl;
  }

  discard(): void {
    try {
      sessionStorage.removeItem(STORAGE_KEY);
    } catch {
      /* idem */
    }
  }

  private read(): StoredHandoff | null {
    try {
      const raw = sessionStorage.getItem(STORAGE_KEY);
      return raw ? (JSON.parse(raw) as StoredHandoff) : null;
    } catch {
      return null;
    }
  }
}
