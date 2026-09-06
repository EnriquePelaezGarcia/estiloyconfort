import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  computed,
  input,
  output,
  signal,
} from '@angular/core';

/** Una diapositiva del visor: URL ya resuelta y su texto alternativo. */
export interface LightboxImage {
  src: string;
  alt?: string;
}

/**
 * Modal para ver una imagen a tamaño completo. Genérico: nació para la foto
 * del producto en los tickets/cotizaciones públicas (clic para ampliar — el
 * hover no sirve de nada ahí, esas páginas se abren casi siempre desde
 * WhatsApp en el celular).
 *
 * Dos modos:
 *   - una sola foto: `[src]` (+ `[alt]`).
 *   - carrusel: `[images]` (+ `[startIndex]`) — flechas, puntitos y swipe
 *     cuando hay más de una. Lo usa la ficha pública del producto.
 */
@Component({
  selector: 'app-image-lightbox',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './image-lightbox.component.html',
  styleUrl: './image-lightbox.component.scss',
  host: {
    '(document:keydown.escape)': 'closed.emit()',
    '(document:keydown.arrowleft)': 'prev()',
    '(document:keydown.arrowright)': 'next()',
  },
})
export class ImageLightboxComponent implements OnInit {
  /** Modo una sola foto. Ignorado si se pasa `images`. */
  readonly src = input<string>();
  readonly alt = input<string>('');

  /** Modo carrusel: todas las fotos a navegar. */
  readonly images = input<LightboxImage[]>();
  /** Índice inicial dentro de `images`. */
  readonly startIndex = input<number>(0);

  readonly closed = output<void>();

  protected readonly index = signal(0);

  /** Lista efectiva de diapositivas, venga de `images` o de `src`. */
  protected readonly slides = computed<LightboxImage[]>(() => {
    const arr = this.images();
    if (arr?.length) return arr;
    const single = this.src();
    return single ? [{ src: single, alt: this.alt() }] : [];
  });

  protected readonly current = computed<LightboxImage | null>(
    () => this.slides()[this.index()] ?? null,
  );

  protected readonly hasMultiple = computed(() => this.slides().length > 1);

  private touchStartX = 0;

  ngOnInit(): void {
    const max = Math.max(0, this.slides().length - 1);
    this.index.set(Math.min(Math.max(0, this.startIndex()), max));
  }

  protected prev(): void {
    const n = this.slides().length;
    if (n > 1) this.index.update((i) => (i - 1 + n) % n);
  }

  protected next(): void {
    const n = this.slides().length;
    if (n > 1) this.index.update((i) => (i + 1) % n);
  }

  protected goTo(i: number): void {
    this.index.set(i);
  }

  protected onTouchStart(event: TouchEvent): void {
    this.touchStartX = event.changedTouches[0]?.clientX ?? 0;
  }

  protected onTouchEnd(event: TouchEvent): void {
    const endX = event.changedTouches[0]?.clientX ?? 0;
    const dx = endX - this.touchStartX;
    if (Math.abs(dx) < 40) return;
    if (dx < 0) this.next();
    else this.prev();
  }
}
