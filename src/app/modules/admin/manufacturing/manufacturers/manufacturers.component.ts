import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ManufacturingService } from '../../../../core/services/manufacturing.service';
import { AdminService } from '../../../../core/services/admin.service';
import { NotificationService } from '../../../../core/services/notification.service';
import { Manufacturer, ManufacturerInput } from '../../../../core/models/manufacturing.model';

/**
 * Alta y edición de fabricantes. `manufacturers` es LA entidad Fabricante: a
 * quién se le compra, con sus costos por producto y sus órdenes de compra.
 *
 * Un fabricante puede existir sin ningún usuario —al que se le compra una sola
 * vez no se le da acceso al sistema—, por eso la tabla distingue quién entra al
 * portal y quién no: si no, no habría forma de saber a quién le falta.
 */
@Component({
  selector: 'app-manufacturers',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './manufacturers.component.html',
  styleUrl: './manufacturers.component.scss',
  imports: [ReactiveFormsModule],
})
export class ManufacturersComponent implements OnInit {
  private manufacturingService = inject(ManufacturingService);
  private adminService = inject(AdminService);
  private notification = inject(NotificationService);
  private fb = inject(FormBuilder);

  protected manufacturers = signal<Manufacturer[]>([]);
  protected loading = signal(true);
  protected saving = signal(false);

  /** Fabricante en edición (null = creando). undefined = modal cerrado. */
  protected editing = signal<Manufacturer | null | undefined>(undefined);

  /** Id del rol Fabricante, necesario para crear el login desde el alta. */
  private manufacturerRoleId = signal<number | null>(null);

  protected form = this.fb.group({
    name: ['', [Validators.required, Validators.minLength(3)]],
    contactName: [''],
    phone: [''],
    email: [''],
    address: [''],
    notes: [''],
    /** Decide si además se crea el login del portal. Ver createAccess(). */
    createAccess: [false],
    accessFullName: [''],
    accessEmail: [''],
    accessPassword: [''],
  });

  protected isModalOpen = computed(() => this.editing() !== undefined);
  protected isEditMode = computed(() => !!this.editing());

  ngOnInit(): void {
    this.loadManufacturers();
    this.adminService.getRoles().subscribe({
      next: (roles) =>
        this.manufacturerRoleId.set(roles.find((r) => r.name === 'manufacturer')?.id ?? null),
      error: () => {},
    });
  }

  protected loadManufacturers(): void {
    this.loading.set(true);
    this.manufacturingService.getManufacturers(true).subscribe({
      next: (res) => {
        this.manufacturers.set(res.data);
        this.loading.set(false);
      },
      error: () => {
        this.loading.set(false);
        this.notification.error('No se pudieron cargar los fabricantes');
      },
    });
  }

  /** ¿El alta debe crear también el login del portal? */
  protected createAccess = signal(false);

  /**
   * Los campos de acceso solo son obligatorios mientras el checkbox está
   * marcado: es un solo formulario, no dos.
   */
  protected onCreateAccessToggle(event: Event): void {
    const checked = (event.target as HTMLInputElement).checked;
    this.createAccess.set(checked);

    const { accessFullName, accessEmail, accessPassword } = this.form.controls;
    if (checked) {
      accessFullName.addValidators(Validators.required);
      accessEmail.addValidators([Validators.required, Validators.email]);
      accessPassword.addValidators([Validators.required, Validators.minLength(8)]);
    } else {
      accessFullName.clearValidators();
      accessEmail.clearValidators();
      accessPassword.clearValidators();
    }
    accessFullName.updateValueAndValidity();
    accessEmail.updateValueAndValidity();
    accessPassword.updateValueAndValidity();
  }

  // ===== Modal =====
  protected openCreate(): void {
    this.editing.set(null);
    this.createAccess.set(false);
    this.resetAccessValidators();
    this.form.reset({
      name: '',
      contactName: '',
      phone: '',
      email: '',
      address: '',
      notes: '',
      createAccess: false,
      accessFullName: '',
      accessEmail: '',
      accessPassword: '',
    });
  }

  protected openEdit(manufacturer: Manufacturer): void {
    this.editing.set(manufacturer);
    // El acceso solo se decide al dar de alta; después se gestiona en Usuarios.
    this.createAccess.set(false);
    this.resetAccessValidators();
    this.form.reset({
      name: manufacturer.name,
      contactName: manufacturer.contactName ?? '',
      phone: manufacturer.phone ?? '',
      email: manufacturer.email ?? '',
      address: manufacturer.address ?? '',
      notes: manufacturer.notes ?? '',
      createAccess: false,
      accessFullName: '',
      accessEmail: '',
      accessPassword: '',
    });
  }

  private resetAccessValidators(): void {
    const { accessFullName, accessEmail, accessPassword } = this.form.controls;
    accessFullName.clearValidators();
    accessEmail.clearValidators();
    accessPassword.clearValidators();
    accessFullName.updateValueAndValidity();
    accessEmail.updateValueAndValidity();
    accessPassword.updateValueAndValidity();
  }

  protected closeModal(): void {
    this.editing.set(undefined);
    this.createAccess.set(false);
  }

  protected save(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    const raw = this.form.getRawValue();
    const payload: ManufacturerInput = {
      name: raw.name!.trim(),
      contactName: raw.contactName?.trim() || null,
      phone: raw.phone?.trim() || null,
      email: raw.email?.trim() || null,
      address: raw.address?.trim() || null,
      notes: raw.notes?.trim() || null,
    };

    this.saving.set(true);
    const target = this.editing();
    if (target) {
      this.manufacturingService.updateManufacturer(target.id, payload).subscribe({
        next: () => this.finish('Fabricante actualizado'),
        error: (err) => this.onError(err),
      });
      return;
    }

    this.manufacturingService.createManufacturer(payload).subscribe({
      next: (res) => {
        if (this.createAccess()) {
          this.createLogin(res.data);
          return;
        }
        this.finish('Fabricante creado');
      },
      error: (err) => this.onError(err),
    });
  }

  /**
   * Crea el login del portal para un fabricante recién dado de alta.
   *
   * No hay transacción a propósito: si esto falla (típicamente porque el correo
   * ya está en uso) el fabricante ya quedó creado y se conserva. Reintentar el
   * alta completa duplicaría la empresa; el acceso se agrega después desde
   * Usuarios.
   */
  private createLogin(manufacturer: Manufacturer): void {
    const roleId = this.manufacturerRoleId();
    if (!roleId) {
      this.finishWithWarning(
        `Fabricante creado, pero no se pudo crear su acceso: no se encontró el rol Fabricante. Créalo desde Usuarios.`,
      );
      return;
    }

    const raw = this.form.getRawValue();
    this.adminService
      .createUser({
        fullName: raw.accessFullName!.trim(),
        email: raw.accessEmail!.trim(),
        password: raw.accessPassword!,
        phone: raw.phone?.trim() || null,
        roleId,
        manufacturerId: manufacturer.id,
      })
      .subscribe({
        next: () => this.finish('Fabricante creado con su acceso al sistema'),
        error: (err: { error?: { message?: string } }) =>
          this.finishWithWarning(
            `Fabricante creado, pero no se pudo crear su acceso: ${
              err?.error?.message ?? 'error desconocido'
            }. Créalo desde Usuarios.`,
          ),
      });
  }

  private finish(message: string): void {
    this.saving.set(false);
    this.notification.success(message);
    this.closeModal();
    this.loadManufacturers();
  }

  private finishWithWarning(message: string): void {
    this.saving.set(false);
    this.notification.info(message);
    this.closeModal();
    this.loadManufacturers();
  }

  private onError(err: { error?: { message?: string } }): void {
    this.saving.set(false);
    this.notification.error(err?.error?.message ?? 'Ocurrió un error al guardar');
  }

  /**
   * Desactivar saca al fabricante de los selects de asignación, pero no toca los
   * items ya asignados ni sus costos congelados.
   */
  protected toggleActive(manufacturer: Manufacturer): void {
    this.manufacturingService
      .toggleManufacturerActive(manufacturer.id, !manufacturer.isActive)
      .subscribe({
        next: (res) => {
          this.manufacturers.update((list) =>
            list.map((m) => (m.id === manufacturer.id ? { ...m, isActive: res.data.isActive } : m)),
          );
          this.notification.success(
            res.data.isActive ? 'Fabricante activado' : 'Fabricante desactivado',
          );
        },
        error: () => this.notification.error('No se pudo cambiar el estado'),
      });
  }
}
