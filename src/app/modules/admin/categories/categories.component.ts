import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { CategoryService } from '../../../core/services/category.service';
import { NotificationService } from '../../../core/services/notification.service';
import { Category } from '../../../core/models/category.model';
import { MediaUrlPipe } from '../../../shared/pipes/media-url.pipe';

@Component({
  selector: 'app-admin-categories',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './categories.component.html',
  styleUrl: './categories.component.scss',
  imports: [ReactiveFormsModule, MediaUrlPipe],
})
export class CategoriesComponent implements OnInit {
  private categoryService = inject(CategoryService);
  private notification = inject(NotificationService);
  private fb = inject(FormBuilder);

  protected categories = signal<Category[]>([]);
  protected loading = signal(true);
  protected saving = signal(false);

  /** Categoría en edición (null = creando). undefined = modal cerrado. */
  protected editing = signal<Category | null | undefined>(undefined);
  /** Categoría con la confirmación de borrado abierta. */
  protected deleting = signal<Category | null>(null);
  /** Id de la categoría cuya foto se está subiendo, para el spinner. */
  protected uploadingId = signal<number | null>(null);

  protected form = this.fb.nonNullable.group({
    name: ['', [Validators.required, Validators.maxLength(255)]],
    description: [''],
  });

  protected isEditMode = computed(() => !!this.editing());

  /**
   * La portada pinta un banner destacado con la categoría de recámaras, y ese
   * banner SÍ exige foto (ver home.component.ts). Se avisa aquí para que no
   * quede la duda de por qué no aparece.
   */
  protected bedroomWithoutPhoto = computed(() =>
    this.categories().find(
      (c) => c.is_active && /recamar|cama/i.test(`${c.slug} ${c.name}`) && !c.image_url,
    ),
  );

  ngOnInit(): void {
    this.load();
  }

  private load(): void {
    this.loading.set(true);
    this.categoryService.getAllAdmin().subscribe({
      next: (cats) => {
        this.categories.set(cats);
        this.loading.set(false);
      },
      error: () => {
        this.notification.error('No se pudieron cargar las categorías');
        this.loading.set(false);
      },
    });
  }

  /** Reemplaza una categoría en la lista sin recargar todo. */
  private replace(updated: Category): void {
    this.categories.update((list) =>
      list.map((c) => (c.id === updated.id ? { ...c, ...updated } : c)),
    );
  }

  // ===== Alta y edición =====

  protected openCreate(): void {
    this.form.reset({ name: '', description: '' });
    this.editing.set(null);
  }

  protected openEdit(category: Category): void {
    this.form.reset({
      name: category.name,
      description: category.description ?? '',
    });
    this.editing.set(category);
  }

  protected closeModal(): void {
    this.editing.set(undefined);
  }

  protected save(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    const raw = this.form.getRawValue();
    const payload = {
      name: raw.name.trim(),
      description: raw.description.trim() || null,
    };

    this.saving.set(true);
    const current = this.editing();

    const done = {
      next: (cat: Category) => {
        if (current) {
          this.replace(cat);
          this.notification.success('Categoría actualizada');
        } else {
          this.categories.update((list) => [...list, cat]);
          this.notification.success('Categoría creada');
          // Nace al final de la portada: con order_display 0 competiría con
          // la primera y el orden quedaría a merced del desempate por nombre.
          this.moveToEnd(cat);
        }
        this.saving.set(false);
        this.closeModal();
      },
      error: (err: { error?: { message?: string } }) => {
        this.notification.error(err?.error?.message ?? 'No se pudo guardar');
        this.saving.set(false);
      },
    };

    if (current) this.categoryService.update(current.id, payload).subscribe(done);
    else this.categoryService.create(payload).subscribe(done);
  }

  private moveToEnd(cat: Category): void {
    const order = this.categories().length;
    this.categoryService.update(cat.id, { order_display: order }).subscribe({
      next: (updated) => this.replace(updated),
    });
  }

  // ===== Visibilidad, orden y borrado =====

  protected toggleActive(category: Category): void {
    this.categoryService.update(category.id, { is_active: !category.is_active }).subscribe({
      next: (updated) => {
        this.replace(updated);
        this.notification.success(
          updated.is_active ? 'Categoría visible en la portada' : 'Categoría oculta de la portada',
        );
      },
      error: () => this.notification.error('No se pudo cambiar la visibilidad'),
    });
  }

  /**
   * Reordenar es intercambiar el `order_display` con el vecino. Se mandan dos
   * PATCH sueltos: son dos filas, no amerita un endpoint de lote. La lista se
   * reacomoda en el acto y solo se recarga del servidor si algo falla.
   */
  protected move(category: Category, direction: -1 | 1): void {
    const list = this.categories();
    const index = list.findIndex((c) => c.id === category.id);
    const target = list[index + direction];
    if (!target) return;

    const reordered = [...list];
    reordered[index] = target;
    reordered[index + direction] = category;
    this.categories.set(reordered.map((c, i) => ({ ...c, order_display: i })));

    this.categoryService
      .update(category.id, { order_display: index + direction })
      .subscribe({ error: () => this.load() });
    this.categoryService
      .update(target.id, { order_display: index })
      .subscribe({ error: () => this.load() });
  }

  protected confirmDelete(category: Category): void {
    this.deleting.set(category);
  }

  protected cancelDelete(): void {
    this.deleting.set(null);
  }

  protected doDelete(): void {
    const category = this.deleting();
    if (!category) return;

    this.categoryService.remove(category.id).subscribe({
      next: () => {
        this.categories.update((list) => list.filter((c) => c.id !== category.id));
        this.notification.success('Categoría eliminada');
        this.deleting.set(null);
      },
      error: (err: { error?: { message?: string } }) => {
        // El backend rechaza borrar una categoría con productos: el FK es
        // ON DELETE SET NULL y los dejaría sin clasificar en silencio.
        this.notification.error(err?.error?.message ?? 'No se pudo eliminar');
        this.deleting.set(null);
      },
    });
  }

  // ===== Foto =====

  protected onImageSelected(event: Event, category: Category): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;

    this.uploadingId.set(category.id);
    this.categoryService.uploadImage(category.id, file).subscribe({
      next: (updated) => {
        this.replace(updated);
        this.notification.success('Foto actualizada');
        this.uploadingId.set(null);
      },
      error: (err: { error?: { message?: string } }) => {
        this.notification.error(err?.error?.message ?? 'No se pudo subir la foto');
        this.uploadingId.set(null);
      },
    });
  }

  protected removeImage(category: Category): void {
    this.categoryService.deleteImage(category.id).subscribe({
      next: (updated) => {
        this.replace(updated);
        this.notification.success('Foto eliminada');
      },
      error: () => this.notification.error('No se pudo eliminar la foto'),
    });
  }
}
