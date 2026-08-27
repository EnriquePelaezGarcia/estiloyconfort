import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule } from '@angular/forms';
import { DatePipe } from '@angular/common';
import { QuillEditorComponent } from 'ngx-quill';
import { SiteContentService } from '../../../core/services/site-content.service';
import { NotificationService } from '../../../core/services/notification.service';
import { SiteContent } from '../../../core/models/site-content.model';

/**
 * Bloques fijos de la ficha de producto (Docs: acordeón Detalles/Política de
 * envíos/Aceptación de política): mismo texto para cualquier producto, así
 * que se editan aparte del catálogo, en una sola pantalla. Solo dos claves
 * hoy — se hardcodean en vez de armar el formulario en un loop porque el
 * conjunto de bloques lo decide la ficha pública (product-detail.component),
 * no este panel.
 */
@Component({
  selector: 'app-admin-content',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './content.component.html',
  styleUrl: './content.component.scss',
  imports: [ReactiveFormsModule, DatePipe, QuillEditorComponent],
})
export class ContentComponent implements OnInit {
  private siteContentService = inject(SiteContentService);
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
