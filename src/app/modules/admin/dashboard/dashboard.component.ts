import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { CurrencyPipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { AdminService } from '../../../core/services/admin.service';
import { NotificationService } from '../../../core/services/notification.service';
import { DashboardStats } from '../../../core/models/admin.model';
import { UserRole } from '../../../core/models/user.model';

const ROLE_LABELS: Record<UserRole, string> = {
  admin: 'Administradores',
  seller: 'Vendedores',
  manufacturer: 'Fabricantes',
  delivery_person: 'Repartidores',
  visitor: 'Visitantes',
};

@Component({
  selector: 'app-admin-dashboard',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './dashboard.component.html',
  styleUrl: './dashboard.component.scss',
  imports: [CurrencyPipe, RouterLink],
})
export class DashboardComponent implements OnInit {
  private adminService = inject(AdminService);
  private notification = inject(NotificationService);

  protected stats = signal<DashboardStats | null>(null);
  protected loading = signal(true);

  ngOnInit(): void {
    this.adminService.getDashboard().subscribe({
      next: (data) => {
        this.stats.set(data);
        this.loading.set(false);
      },
      error: () => {
        this.loading.set(false);
        this.notification.error('No se pudo cargar el dashboard');
      },
    });
  }

  protected roleLabel(role: UserRole): string {
    return ROLE_LABELS[role] ?? role;
  }
}
