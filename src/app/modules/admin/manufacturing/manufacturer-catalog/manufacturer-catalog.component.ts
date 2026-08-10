import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { CurrencyPipe } from '@angular/common';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ManufacturingService } from '../../../../core/services/manufacturing.service';
import { NotificationService } from '../../../../core/services/notification.service';
import {
  Manufacturer,
  ManufacturerCatalogProduct,
  ManufacturerInput,
} from '../../../../core/models/manufacturing.model';
import { MATERIAL_LABELS, MATERIALS } from '../../../../core/models/order.model';

@Component({
  selector: 'app-manufacturer-catalog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './manufacturer-catalog.component.html',
  styleUrl: './manufacturer-catalog.component.scss',
  imports: [CurrencyPipe, ReactiveFormsModule],
})
export class ManufacturerCatalogComponent implements OnInit {
  private manufacturingService = inject(ManufacturingService);
  private notification = inject(NotificationService);
  private fb = inject(FormBuilder);

  protected manufacturers = signal<Manufacturer[]>([]);
  protected products = signal<ManufacturerCatalogProduct[]>([]);
  protected loading = signal(true);
  protected selectedManufacturer = signal<number | null>(null);
  protected readonly materials = MATERIALS;
  protected readonly materialLabels = MATERIAL_LABELS;

  /** Fabricante en edición (null = formulario cerrado, 0 = alta nueva). */
  protected editing = signal<number | null>(null);
  protected saving = signal(false);

  protected readonly form = this.fb.group({
    name: ['', [Validators.required, Validators.maxLength(255)]],
    contactName: [''],
    phone: [''],
    email: ['', [Validators.email]],
    address: [''],
    notes: [''],
  });

  /** Productos sin fabricante asignado (para alertar al admin). */
  protected unassignedCount = computed(
    () => this.products().filter((p) => p.manufacturerId === null).length,
  );

  ngOnInit(): void {
    this.loadManufacturers();
    this.loadCatalog();
  }

  private loadManufacturers(): void {
    this.manufacturingService.getManufacturers(true).subscribe({
      next: (res) => this.manufacturers.set(res.data),
      error: () => this.notification.error('No se pudieron cargar los fabricantes'),
    });
  }

  private loadCatalog(): void {
    this.loading.set(true);
    this.manufacturingService.getCatalog(this.selectedManufacturer() ?? undefined).subscribe({
      next: (res) => {
        this.products.set(res.data);
        this.loading.set(false);
      },
      error: () => {
        this.loading.set(false);
        this.notification.error('No se pudo cargar el catálogo');
      },
    });
  }

  protected onFilterChange(event: Event): void {
    const value = (event.target as HTMLSelectElement).value;
    this.selectedManufacturer.set(value ? Number(value) : null);
    this.loadCatalog();
  }

  protected openCreate(): void {
    this.editing.set(0);
    this.form.reset({ name: '', contactName: '', phone: '', email: '', address: '', notes: '' });
  }

  protected openEdit(m: Manufacturer): void {
    this.editing.set(m.id);
    this.form.reset({
      name: m.name,
      contactName: m.contactName ?? '',
      phone: m.phone ?? '',
      email: m.email ?? '',
      address: m.address ?? '',
      notes: m.notes ?? '',
    });
  }

  protected closeForm(): void {
    this.editing.set(null);
  }

  protected save(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    this.saving.set(true);
    const v = this.form.getRawValue();
    const input: ManufacturerInput = {
      name: (v.name ?? '').trim(),
      contactName: v.contactName || null,
      phone: v.phone || null,
      email: v.email || null,
      address: v.address || null,
      notes: v.notes || null,
    };
    const id = this.editing();
    const request$ =
      id && id > 0
        ? this.manufacturingService.updateManufacturer(id, input)
        : this.manufacturingService.createManufacturer(input);

    request$.subscribe({
      next: () => {
        this.notification.success(id && id > 0 ? 'Fabricante actualizado' : 'Fabricante creado');
        this.saving.set(false);
        this.editing.set(null);
        this.loadManufacturers();
        this.loadCatalog();
      },
      error: (err: { error?: { message?: string } }) => {
        this.saving.set(false);
        this.notification.error(err?.error?.message ?? 'No se pudo guardar el fabricante');
      },
    });
  }

  protected toggleActive(m: Manufacturer): void {
    this.manufacturingService.toggleManufacturerActive(m.id, !m.isActive).subscribe({
      next: () => {
        this.notification.success(m.isActive ? 'Fabricante desactivado' : 'Fabricante activado');
        this.loadManufacturers();
      },
      error: () => this.notification.error('No se pudo actualizar el fabricante'),
    });
  }
}
