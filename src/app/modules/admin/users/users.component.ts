import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { AdminService } from '../../../core/services/admin.service';
import { AuthService } from '../../../core/auth/auth.service';
import { ManufacturingService } from '../../../core/services/manufacturing.service';
import { NotificationService } from '../../../core/services/notification.service';
import { PHONE_PATTERN, formatPhoneDigits, formatPhoneForDisplay } from '../../../core/utils/phone';
import { User, UserRole } from '../../../core/models/user.model';
import { Manufacturer } from '../../../core/models/manufacturing.model';
import {
  CreateUserRequest,
  CreateUserResponse,
  Role,
  UpdateUserRequest,
} from '../../../core/models/admin.model';

const ROLE_LABELS: Record<UserRole, string> = {
  admin: 'Administrador',
  seller: 'Vendedor',
  manufacturer: 'Fabricante',
  delivery_person: 'Repartidor',
  visitor: 'Visitante',
};

@Component({
  selector: 'app-admin-users',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './users.component.html',
  styleUrl: './users.component.scss',
  imports: [ReactiveFormsModule],
})
export class UsersComponent implements OnInit {
  private adminService = inject(AdminService);
  private auth = inject(AuthService);
  private manufacturingService = inject(ManufacturingService);
  private notification = inject(NotificationService);
  private fb = inject(FormBuilder);

  protected users = signal<User[]>([]);
  protected roles = signal<Role[]>([]);
  /** Fabricantes activos, para ligar el login al que representa. */
  protected manufacturers = signal<Manufacturer[]>([]);
  protected loading = signal(true);
  protected saving = signal(false);
  protected search = signal('');

  /** Usuario en edición (null = creando). undefined = modal cerrado. */
  protected editing = signal<User | null | undefined>(undefined);
  /** Usuario marcado para eliminar (confirmación). */
  protected deleting = signal<User | null>(null);

  /** Usuario marcado para restablecer contraseña (confirmación). */
  protected resetting = signal<User | null>(null);
  protected resettingInProgress = signal(false);
  /**
   * Contraseña temporal recién generada. Solo vive en memoria y solo hasta que
   * se cierre el modal: el servidor no la guarda en claro ni la puede repetir.
   */
  protected temporaryPassword = signal<string | null>(null);
  protected resetUserName = signal('');
  protected copied = signal(false);

  protected form = this.fb.group({
    fullName: ['', [Validators.required, Validators.minLength(3)]],
    email: ['', [Validators.required, Validators.email]],
    // Opcional; si lo capturan, 10 dígitos ("222 123 4567"). Vacío pasa el pattern.
    phone: ['', [Validators.pattern(PHONE_PATTERN)]],
    roleId: [null as number | null, Validators.required],
    manufacturerId: [null as number | null],
    isActive: [true],
    // Solo se envía (y se muestra) para el rol Vendedor: le permite ajustar
    // existencias e imprimir etiquetas en la pantalla de Inventario.
    canAdjustInventory: [false],
  });

  /**
   * El vínculo con un fabricante solo aplica al rol Fabricante, y ahí es
   * obligatorio: un usuario sin fabricante entra al portal y no ve nada.
   */
  protected isManufacturerRole = signal(false);

  /** El checkbox de permiso de inventario solo aplica al rol Vendedor. */
  protected isSellerRole = signal(false);

  constructor() {
    this.form.controls.roleId.valueChanges.pipe(takeUntilDestroyed()).subscribe((roleId) => {
      const roleName = this.roles().find((r) => r.id === roleId)?.name;
      const isManufacturer = roleName === 'manufacturer';
      this.isManufacturerRole.set(isManufacturer);

      this.isSellerRole.set(roleName === 'seller');
      if (roleName !== 'seller') {
        this.form.controls.canAdjustInventory.setValue(false, { emitEvent: false });
      }

      const control = this.form.controls.manufacturerId;
      if (isManufacturer) {
        control.addValidators(Validators.required);
      } else {
        control.clearValidators();
        control.setValue(null, { emitEvent: false });
      }
      control.updateValueAndValidity({ emitEvent: false });
    });
  }

  protected isModalOpen = computed(() => this.editing() !== undefined);
  protected isEditMode = computed(() => !!this.editing());

  /** El rol 'visitor' es el acceso anónimo por defecto; no se asigna manualmente. */
  protected assignableRoles = computed(() => this.roles().filter((r) => r.name !== 'visitor'));

  protected filteredUsers = computed(() => {
    const term = this.search().trim().toLowerCase();
    if (!term) return this.users();
    return this.users().filter(
      (u) =>
        u.fullName.toLowerCase().includes(term) ||
        u.email.toLowerCase().includes(term) ||
        ROLE_LABELS[u.role].toLowerCase().includes(term),
    );
  });

  ngOnInit(): void {
    this.adminService.getRoles().subscribe({
      next: (roles) => this.roles.set(roles),
      error: () => this.notification.error('No se pudieron cargar los roles'),
    });
    this.manufacturingService.getManufacturers().subscribe({
      next: (res) => this.manufacturers.set(res.data),
      error: () => {},
    });
    this.loadUsers();
  }

  protected loadUsers(): void {
    this.loading.set(true);
    this.adminService.getUsers().subscribe({
      next: (users) => {
        this.users.set(users);
        this.loading.set(false);
      },
      error: () => {
        this.loading.set(false);
        this.notification.error('No se pudieron cargar los usuarios');
      },
    });
  }

  protected roleLabel(role: UserRole): string {
    return ROLE_LABELS[role] ?? role;
  }

  // ===== Modal =====
  protected openCreate(): void {
    this.editing.set(null);
    this.form.reset({ isActive: true, roleId: null, manufacturerId: null, canAdjustInventory: false });
  }

  protected openEdit(user: User): void {
    this.editing.set(user);
    this.form.reset({
      fullName: user.fullName,
      email: user.email,
      phone: formatPhoneForDisplay(user.phone ?? ''),
      roleId: this.roles().find((r) => r.name === user.role)?.id ?? null,
      manufacturerId: user.manufacturerId ?? null,
      isActive: user.isActive,
      canAdjustInventory: user.canAdjustInventory ?? false,
    });
  }

  protected closeModal(): void {
    this.editing.set(undefined);
  }

  /** Recorta a 10 dígitos y formatea "222 123 4567" mientras se escribe. */
  protected onPhoneInput(event: Event): void {
    this.form.controls.phone.setValue(formatPhoneDigits((event.target as HTMLInputElement).value));
  }

  protected save(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    const raw = this.form.getRawValue();
    this.saving.set(true);

    const target = this.editing();
    if (target) {
      const payload: UpdateUserRequest = {
        email: raw.email!,
        fullName: raw.fullName!,
        phone: raw.phone || null,
        roleId: raw.roleId!,
        manufacturerId: raw.manufacturerId ?? null,
        isActive: raw.isActive!,
        canAdjustInventory: raw.canAdjustInventory ?? false,
      };
      this.adminService.updateUser(target.id, payload).subscribe({
        next: (updated) => this.onSaved(updated, 'Usuario actualizado'),
        error: (err) => this.onError(err),
      });
    } else {
      const payload: CreateUserRequest = {
        fullName: raw.fullName!,
        email: raw.email!,
        phone: raw.phone || null,
        roleId: raw.roleId!,
        manufacturerId: raw.manufacturerId ?? null,
        canAdjustInventory: raw.canAdjustInventory ?? false,
      };
      this.adminService.createUser(payload).subscribe({
        next: (res) => this.onCreated(res),
        error: (err) => this.onError(err),
      });
    }
  }

  private onSaved(user: User, message: string): void {
    this.users.update((list) => {
      const idx = list.findIndex((u) => u.id === user.id);
      if (idx === -1) return [...list, user];
      const next = [...list];
      next[idx] = user;
      return next;
    });
    this.saving.set(false);
    this.notification.success(message);
    this.closeModal();
  }

  /**
   * La temporal solo se ve una vez: se reusa el mismo modal del reset
   * administrativo en vez de un simple toast de éxito.
   */
  private onCreated(res: CreateUserResponse): void {
    this.users.update((list) => [...list, res.user]);
    this.saving.set(false);
    this.closeModal();
    this.resetUserName.set(res.user.fullName);
    this.copied.set(false);
    this.temporaryPassword.set(res.temporaryPassword);
  }

  private onError(err: { error?: { message?: string } }): void {
    this.saving.set(false);
    this.notification.error(err?.error?.message ?? 'Ocurrió un error al guardar');
  }

  // ===== Toggle status =====
  protected toggleStatus(user: User): void {
    this.adminService.toggleUserStatus(user.id).subscribe({
      next: (updated) => {
        this.users.update((list) => list.map((u) => (u.id === updated.id ? updated : u)));
        this.notification.success(
          updated.isActive ? 'Usuario activado' : 'Usuario desactivado',
        );
      },
      error: () => this.notification.error('No se pudo cambiar el estado'),
    });
  }

  // ===== Restablecer contraseña =====
  // El admin NO puede ver la contraseña de nadie: son hash bcrypt, es
  // irreversible. Lo que puede es generar una temporal que el usuario está
  // obligado a cambiar al entrar. Ver Docs/plan-modulo-contrasenas.md.

  /** El admin no se resetea a sí mismo: para eso está Cambiar contraseña. */
  protected canReset(user: User): boolean {
    return user.id !== this.auth.currentUser()?.id;
  }

  protected confirmReset(user: User): void {
    this.resetting.set(user);
  }

  protected cancelReset(): void {
    this.resetting.set(null);
  }

  protected executeReset(): void {
    const user = this.resetting();
    if (!user) return;
    this.resettingInProgress.set(true);

    this.adminService.resetUserPassword(user.id).subscribe({
      next: (res) => {
        this.resettingInProgress.set(false);
        this.resetting.set(null);
        this.resetUserName.set(user.fullName);
        this.copied.set(false);
        this.temporaryPassword.set(res.temporaryPassword);
        // La lista debe reflejar que ese usuario trae contraseña temporal.
        this.users.update((list) =>
          list.map((u) => (u.id === user.id ? { ...u, mustChangePassword: true } : u)),
        );
      },
      error: (err: { error?: { message?: string } }) => {
        this.resettingInProgress.set(false);
        this.resetting.set(null);
        this.notification.error(
          err?.error?.message ?? 'No se pudo restablecer la contraseña',
        );
      },
    });
  }

  protected async copyTemporaryPassword(): Promise<void> {
    const password = this.temporaryPassword();
    if (!password) return;
    try {
      await navigator.clipboard.writeText(password);
      this.copied.set(true);
    } catch {
      // Sin permiso de portapapeles (o sin HTTPS) queda visible en pantalla
      // para copiarla a mano: no es un error que valga la pena escalar.
      this.notification.info('Cópiala manualmente de la pantalla');
    }
  }

  protected closeTemporaryPassword(): void {
    this.temporaryPassword.set(null);
    this.resetUserName.set('');
    this.copied.set(false);
  }

  // ===== Delete =====
  protected confirmDelete(user: User): void {
    this.deleting.set(user);
  }

  protected cancelDelete(): void {
    this.deleting.set(null);
  }

  protected executeDelete(): void {
    const user = this.deleting();
    if (!user) return;
    this.adminService.deleteUser(user.id).subscribe({
      next: () => {
        this.users.update((list) => list.filter((u) => u.id !== user.id));
        this.notification.success('Usuario eliminado');
        this.deleting.set(null);
      },
      error: (err: { error?: { message?: string } }) => {
        this.notification.error(err?.error?.message ?? 'No se pudo eliminar');
        this.deleting.set(null);
      },
    });
  }
}
