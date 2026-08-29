import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule } from '@angular/forms';
import { DatePipe } from '@angular/common';
import { QuillEditorComponent } from 'ngx-quill';
import { SiteContentService } from '../../../core/services/site-content.service';
import { HeroImageService } from '../../../core/services/hero-image.service';
import { HeroImage } from '../../../core/models/hero-image.model';
import { MediaUrlPipe } from '../../../shared/pipes/media-url.pipe';
import { NotificationService } from '../../../core/services/notification.service';
import { SiteContent } from '../../../core/models/site-content.model';

/**
 * Pantalla del contenido del sitio público que no vive en el catálogo:
 *
 * - Foto(s) del hero de la portada. El modo lo decide el conteo, no una
 *   bandera: una queda fija, dos o más arman el carrusel (ver home.component).
 * - Bloques fijos de la ficha de producto (acordeón Política de envíos /
 *   Aceptación de política): mismo texto para cualquier producto, así que se
 *   editan aparte del catálogo. Solo dos claves hoy — se hardcodean en vez de
 *   armar el formulario en un loop porque el conjunto de bloques lo decide la
 *   ficha pública (product-detail.component), no este panel.
 */
@Component({
  selector: 'app-admin-content',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './content.component.html',
  styleUrl: './content.component.scss',
  imports: [ReactiveFormsModule, DatePipe, QuillEditorComponent, MediaUrlPipe],
})
export class ContentComponent implements OnInit {
  private siteContentService = inject(SiteContentService);
  private heroImageService = inject(HeroImageService);
  private notification = inject(NotificationService);
  private fb = inject(FormBuilder);

  protected loading = signal(true);
  /** Clave del bloque que se está guardando ahora mismo, o null. */
  protected savingKey = signal<string | null>(null);

  private content = signal<SiteContent[]>([]);
  protected shippingUpdatedAt = computed(() => this.byKey('shipping_policy')?.updated_at ?? null);
  protected policyUpdatedAt = computed(() => this.byKey('policy_acceptance')?.updated_at ?? null);

  protected form = this.fb.nonNullable.group({
    shipping_policy: [''],
    policy_acceptance: [''],
  });

  ngOnInit(): void {
    this.load();
    this.loadHero();
  }

  private byKey(key: string): SiteContent | null {
    return this.content().find((c) => c.content_key === key) ?? null;
  }

  private load(): void {
    this.loading.set(true);
    this.siteContentService.getAll().subscribe({
      next: (data) => {
        this.content.set(data);
        this.form.reset({
          shipping_policy: data.find((c) => c.content_key === 'shipping_policy')?.body ?? '',
          policy_acceptance: data.find((c) => c.content_key === 'policy_acceptance')?.body ?? '',
        });
        this.loading.set(false);
      },
      error: () => {
        this.notification.error('No se pudo cargar el contenido');
        this.loading.set(false);
      },
    });
  }

  // ===== Foto principal de Home =====

  protected heroImages = signal<HeroImage[]>([]);
  protected heroLoading = signal(true);
  protected heroUploading = signal(false);
  /** Id de la foto con una acción en curso (mover/borrar/guardar texto). */
  protected heroBusyId = signal<number | null>(null);
  /** Id de la foto con el "¿eliminar?" abierto — confirmación en la misma fila. */
  protected heroConfirmId = signal<number | null>(null);

  /**
   * Lo que hará la portada con lo que hay cargado. No es una preferencia que
   * el admin elija: la decide el conteo, y este texto solo se lo explica.
   */
  protected heroMode = computed<'empty' | 'fixed' | 'carousel'>(() => {
    const total = this.heroImages().length;
    if (total === 0) return 'empty';
    return total === 1 ? 'fixed' : 'carousel';
  });

  private loadHero(): void {
    this.heroLoading.set(true);
    this.heroImageService.getAll().subscribe({
      next: (images) => {
        this.heroImages.set(images);
        this.heroLoading.set(false);
      },
      error: () => {
        this.notification.error('No se pudieron cargar las fotos de la portada');
        this.heroLoading.set(false);
      },
    });
  }

  protected onHeroSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    // Se limpia el input para que elegir el MISMO archivo otra vez vuelva a
    // disparar el change (si no, el navegador lo considera sin cambios).
    input.value = '';
    if (!file) return;

    this.heroUploading.set(true);
    this.heroImageService.upload(file).subscribe({
      next: (image) => {
        this.heroImages.update((list) => [...list, image]);
        this.notification.success('Foto agregada a la portada');
        this.heroUploading.set(false);
      },
      error: (err: { error?: { message?: string } }) => {
        this.notification.error(err?.error?.message ?? 'No se pudo subir la foto');
        this.heroUploading.set(false);
      },
    });
  }

  protected moveHero(image: HeroImage, direction: 'up' | 'down'): void {
    this.heroBusyId.set(image.id);
    this.heroImageService.move(image.id, direction).subscribe({
      next: (images) => {
        this.heroImages.set(images);
        this.heroBusyId.set(null);
      },
      error: () => {
        this.notification.error('No se pudo cambiar el orden');
        this.heroBusyId.set(null);
      },
    });
  }

  protected askRemoveHero(image: HeroImage): void {
    this.heroConfirmId.set(image.id);
  }

  protected cancelRemoveHero(): void {
    this.heroConfirmId.set(null);
  }

  protected removeHero(image: HeroImage): void {
    this.heroBusyId.set(image.id);
    this.heroImageService.remove(image.id).subscribe({
      next: (images) => {
        this.heroImages.set(images);
        this.heroConfirmId.set(null);
        this.notification.success('Foto eliminada');
        this.heroBusyId.set(null);
      },
      error: () => {
        this.notification.error('No se pudo eliminar la foto');
        this.heroBusyId.set(null);
      },
    });
  }

  /**
   * Texto alternativo, al salir del campo. Se compara contra lo guardado para
   * no mandar una petición cada vez que el foco pasa por encima.
   */
  protected saveHeroAlt(image: HeroImage, event: Event): void {
    const value = (event.target as HTMLInputElement).value.trim();
    if (value === (image.alt_text ?? '')) return;

    this.heroBusyId.set(image.id);
    this.heroImageService.updateAlt(image.id, value).subscribe({
      next: (updated) => {
        this.heroImages.update((list) => list.map((i) => (i.id === updated.id ? updated : i)));
        this.heroBusyId.set(null);
      },
      error: () => {
        this.notification.error('No se pudo guardar la descripción');
        this.heroBusyId.set(null);
      },
    });
  }

  protected save(key: 'shipping_policy' | 'policy_acceptance'): void {
    const body = this.form.getRawValue()[key];
    this.savingKey.set(key);
    this.siteContentService.update(key, body).subscribe({
      next: (updated) => {
        this.content.update((list) => list.map((c) => (c.content_key === key ? updated : c)));
        this.notification.success('Contenido actualizado');
        this.savingKey.set(null);
      },
      error: (err: { error?: { message?: string } }) => {
        this.notification.error(err?.error?.message ?? 'No se pudo guardar');
        this.savingKey.set(null);
      },
    });
  }
}
