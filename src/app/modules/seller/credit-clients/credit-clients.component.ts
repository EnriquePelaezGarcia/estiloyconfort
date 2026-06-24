import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { CurrencyPipe, DatePipe } from '@angular/common';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { SellerService } from '../../../core/services/seller.service';
import { NotificationService } from '../../../core/services/notification.service';
import { CreditClient } from '../../../core/models/order.model';
import { PAYMENT_METHOD_LABELS } from '../../../core/models/order-labels';

type FilterTab = 'all' | 'store_credit' | 'layaway';

@Component({
  selector: 'app-credit-clients',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './credit-clients.component.html',
  styleUrl: './credit-clients.component.scss',
  imports: [CurrencyPipe, DatePipe, ReactiveFormsModule, RouterLink],
})
export class CreditClientsComponent implements OnInit {
  private sellerService = inject(SellerService);
  private notification = inject(NotificationService);
  private fb = inject(FormBuilder);

  protected loading = signal(true);
  protected clients = signal<CreditClient[]>([]);
  protected activeTab = signal<FilterTab>('all');
  protected searchQuery = signal('');
  protected selectedClient = signal<CreditClient | null>(null);
  protected savingPayment = signal(false);

  protected paymentForm = this.fb.group({
    amount: [null as number | null, [Validators.required, Validators.min(1)]],
    paymentMethod: ['cash', Validators.required],
    notes: [''],
  });

  protected readonly PAYMENT_METHOD_LABELS = PAYMENT_METHOD_LABELS;

  protected filtered = computed(() => {
    const tab = this.activeTab();
    const q = this.searchQuery().toLowerCase().trim();
    let result = this.clients();
    if (tab !== 'all') result = result.filter((c) => c.paymentMethod === tab);
    if (q) {
      result = result.filter(
        (c) =>
          c.customerName.toLowerCase().includes(q) ||
          c.orderNumber.toLowerCase().includes(q),
      );
    }
    return result;
  });

  protected totalBalance = computed(() =>
    this.filtered().reduce((sum, c) => sum + c.balance, 0),
  );

  protected overdueCount = computed(
    () => this.filtered().filter((c) => this.isOverdue(c)).length,
  );

  ngOnInit(): void {
    this.load();
  }

  protected load(): void {
    this.loading.set(true);
    this.sellerService.getCreditClients().subscribe({
      next: ({ data }) => {
        this.clients.set(data);
        this.loading.set(false);
      },
      error: () => {
        this.notification.error('No se pudieron cargar los clientes');
        this.loading.set(false);
      },
    });
  }

  protected setTab(tab: FilterTab): void {
    this.activeTab.set(tab);
  }

  protected openPayment(client: CreditClient): void {
    this.selectedClient.set(client);
    this.paymentForm.reset({ amount: null, paymentMethod: 'cash', notes: '' });
  }

  protected closePayment(): void {
    this.selectedClient.set(null);
  }

  protected submitPayment(): void {
    if (this.paymentForm.invalid) {
      this.paymentForm.markAllAsTouched();
      return;
    }
    const client = this.selectedClient();
    if (!client) return;

    const raw = this.paymentForm.getRawValue();
    this.savingPayment.set(true);

    this.sellerService
      .registerCreditPayment(client.id, raw.amount!, raw.paymentMethod!, raw.notes || undefined)
      .subscribe({
        next: () => {
          this.notification.success('Abono registrado correctamente');
          this.savingPayment.set(false);
          this.selectedClient.set(null);
          this.load();
        },
        error: (err: { error?: { message?: string } }) => {
          this.savingPayment.set(false);
          this.notification.error(err?.error?.message ?? 'No se pudo registrar el abono');
        },
      });
  }

  /** Días restantes hasta el vencimiento del apartado (negativo = vencido). */
  protected daysUntilDeadline(client: CreditClient): number | null {
    if (client.paymentMethod !== 'layaway' || !client.layawayDeadline) return null;
    const deadline = new Date(client.layawayDeadline);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return Math.round((deadline.getTime() - today.getTime()) / 86_400_000);
  }

  protected isOverdue(client: CreditClient): boolean {
    if (client.paymentMethod !== 'layaway') return false;
    const days = this.daysUntilDeadline(client);
    return days !== null && days < 0;
  }

  /** Calcula la fecha del próximo abono semanal para crédito tienda. */
  protected nextWeeklyDate(client: CreditClient): string | null {
    if (client.paymentMethod !== 'store_credit' || !client.weeklyPayment || !client.createdAt) {
      return null;
    }
    const weeksPaid = Math.floor(
      Math.max(0, client.paymentAmount - (client.downPayment ?? 0)) / client.weeklyPayment,
    );
    const next = new Date(client.createdAt);
    next.setDate(next.getDate() + (weeksPaid + 1) * 7);
    return next.toLocaleDateString('es-MX', { weekday: 'long', day: '2-digit', month: 'long' });
  }

  protected pctPaid(client: CreditClient): number {
    if (!client.totalAmount) return 0;
    return Math.min(100, Math.round((client.paymentAmount / client.totalAmount) * 100));
  }
}
