import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { CurrencyPipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { PayablesService } from '../../../../core/services/payables.service';
import { NotificationService } from '../../../../core/services/notification.service';
import { PayableManufacturer } from '../../../../core/models/payable.model';

/**
 * Saldo por fabricante, ordenado de mayor a menor deuda.
 *
 * Sin filtro de período a propósito: un adeudo no desaparece porque cambie el
 * mes. El filtrado por semana/quincena vive en el detalle, que es donde se
 * arma el corte.
 */
@Component({
  selector: 'app-payables-list',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './payables-list.component.html',
  styleUrl: './payables-list.component.scss',
  imports: [CurrencyPipe, RouterLink],
})
export class PayablesListComponent implements OnInit {
  private payablesService = inject(PayablesService);
  private notification = inject(NotificationService);

  protected manufacturers = signal<PayableManufacturer[]>([]);
  protected totalBalance = signal(0);
  protected totalAmount = signal(0);
  protected totalPaid = signal(0);
  protected totalOwed = signal(0);
  protected totalAdvances = signal(0);
  protected loading = signal(true);

  ngOnInit(): void {
    this.payablesService.summary().subscribe({
      next: (res) => {
        this.manufacturers.set(res.data);
        this.totalBalance.set(res.meta.total.balance);
        this.totalAmount.set(res.meta.total.amount);
        this.totalPaid.set(res.meta.total.paid);
        this.totalOwed.set(res.meta.total.owed);
        this.totalAdvances.set(res.meta.total.advances);
        this.loading.set(false);
      },
      error: () => {
        this.notification.error('No se pudieron cargar las cuentas por pagar');
        this.loading.set(false);
      },
    });
  }
}
