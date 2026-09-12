import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { CurrencyPipe } from '@angular/common';
import { ManufacturerService } from '../../../core/services/manufacturer.service';
import { NotificationService } from '../../../core/services/notification.service';
import { ManufacturerOwnCatalogItem } from '../../../core/models/order.model';
import { MediaUrlPipe } from '../../../shared/pipes/media-url.pipe';
import { ImageLightboxComponent } from '../../../shared/components/image-lightbox/image-lightbox.component';

/**
 * "Mis precios" (Fase 6bis.2, D14): el fabricante ve SOLO sus tres costos por
 * material, de solo lectura. No hay botón de editar — la captura de costos
 * sigue siendo exclusiva del admin.
 */
@Component({
  selector: 'app-manufacturer-own-catalog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './manufacturer-own-catalog.component.html',
  styleUrl: './manufacturer-own-catalog.component.scss',
  imports: [CurrencyPipe, MediaUrlPipe, ImageLightboxComponent],
})
export class ManufacturerOwnCatalogComponent implements OnInit {
  private manufacturerService = inject(ManufacturerService);
  private notification = inject(NotificationService);

  protected items = signal<ManufacturerOwnCatalogItem[]>([]);
  protected loading = signal(true);
  protected search = signal('');

  /** Foto del listado abierta a tamaño completo (ruta relativa, sin resolver). */
  protected zoomedImage = signal<{ src: string; alt: string } | null>(null);

  protected openZoom(src: string, alt: string): void {
    this.zoomedImage.set({ src, alt });
  }

  protected filteredItems = computed(() => {
    const term = this.search().trim().toLowerCase();
    if (!term) return this.items();
    return this.items().filter(
      (i) => i.name.toLowerCase().includes(term) || (i.sku?.toLowerCase().includes(term) ?? false),
    );
  });

  ngOnInit(): void {
    this.manufacturerService.getMyCatalog().subscribe({
      next: (res) => {
        this.items.set(res.data);
        this.loading.set(false);
      },
      error: () => {
        this.loading.set(false);
        this.notification.error('No se pudo cargar tu catálogo de costos');
      },
    });
  }

  protected onSearch(event: Event): void {
    this.search.set((event.target as HTMLInputElement).value);
  }
}
