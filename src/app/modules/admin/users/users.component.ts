import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { AdminService } from '../../../core/services/admin.service';
import { NotificationService } from '../../../core/services/notification.service';
import { User, UserRole } from '../../../core/models/user.model';
import { CreateUserRequest, Role, UpdateUserRequest } from '../../../core/models/admin.model';

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
  private notification = inject(NotificationService);
  private fb = inject(FormBuilder);

  protected users = signal<User[]>([]);
  protected roles = signal<Role[]>([]);
  protected loading = signal(true);
  protected saving = signal(false);
  protected search = signal('');

  /** Usuario en edición (null = creando). undefined = modal cerrado. */
  protected editing = signal<User | null | undefined>(undefined);
  /** Usuario marcado para eliminar (confirmación). */
  protected deleting = signal<User | null>(null);

  protected form = this.fb.group({
    fullName: ['', [Validators.required, Validators.minLength(3)]],
    email: ['', [Validators.required, Validators.email]],
    phone: [''],
    password: ['', [Validators.minLength(8)]],
    roleId: [null as number | null, Validators.required],
    isActive: [true],
  });

  protected isModalOpen = computed(() => this.editing() !== undefined);
  protected isEditMode = computed(() => !!this.editing());

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
    this.form.reset({ isActive: true, roleId: null });
    this.form.controls.email.enable();
    this.form.controls.password.addValidators(Validators.required);
    this.form.controls.password.updateValueAndValidity();
  }

  protected openEdit(user: User): void {
    this.editing.set(user);
    this.form.reset({
      fullName: user.fullName,
      email: user.email,
      phone: user.phone ?? '',
      password: '',
      roleId: this.roles().find((r) => r.name === user.role)?.id ?? null,
      isActive: user.isActive,
    });
    this.form.controls.email.disable();
    this.form.controls.password.clearValidators();
    this.form.controls.password.updateValueAndValidity();
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
    this.saving.set(true);

    const target = this.editing();
    if (target) {
      const payload: UpdateUserRequest = {
        fullName: raw.fullName!,
        phone: raw.phone || null,
        roleId: raw.roleId!,
        isActive: raw.isActive!,
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
        password: raw.password!,
        roleId: raw.roleId!,
      };
      this.adminService.createUser(payload).subscribe({
        next: (created) => this.onSaved(created, 'Usuario creado'),
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
