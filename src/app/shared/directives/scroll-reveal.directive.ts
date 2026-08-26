import { Directive, ElementRef, OnDestroy, OnInit, inject, signal } from '@angular/core';

/**
 * Agrega la clase `reveal-visible` la primera vez que el elemento entra en el
 * viewport al hacer scroll. Sustituye al hover como forma de llamar la
 * atención sobre tarjetas no interactivas: a diferencia del hover, funciona
 * igual con mouse (escritorio) que con el dedo (móvil), porque no depende
 * del cursor.
 */
@Directive({
  selector: '[appScrollReveal]',
  host: {
    '[class.reveal-visible]': 'visible()',
  },
})
export class ScrollRevealDirective implements OnInit, OnDestroy {
  private el = inject<ElementRef<HTMLElement>>(ElementRef);
  private observer?: IntersectionObserver;

  protected readonly visible = signal(false);

  ngOnInit(): void {
    // SSR no tiene IntersectionObserver: se muestra directo, sin animación.
    if (typeof IntersectionObserver === 'undefined') {
      this.visible.set(true);
      return;
    }
    this.observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return;
        this.visible.set(true);
        // Una sola vez: no tiene sentido "revelar" de nuevo al salir y volver a entrar.
        this.observer?.disconnect();
      },
      { threshold: 0.2 },
    );
    this.observer.observe(this.el.nativeElement);
  }

  ngOnDestroy(): void {
    this.observer?.disconnect();
  }
}
