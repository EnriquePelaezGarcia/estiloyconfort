import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { CurrencyPipe, DatePipe } from '@angular/common';
import { AdminService } from '../../../core/services/admin.service';
import { NotificationService } from '../../../core/services/notification.service';
import {
  InventoryReportRow,
  OrderStatus,
  PaymentStatus,
  SalesReportRow,
} from '../../../core/models/order.model';
import {
  ORDER_STATUS_LABELS,
  ORDER_STATUS_TONE,
  PAYMENT_STATUS_LABELS,
} from '../../../core/models/order-labels';

type ReportType = 'sales' | 'inventory';

@Component({
  selector: 'app-admin-reports',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './reports.component.html',
  styleUrl: './reports.component.scss',
  imports: [CurrencyPipe, DatePipe],
})
export class ReportsComponent implements OnInit {
  private adminService = inject(AdminService);
  private notification = inject(NotificationService);

  protected reportType = signal<ReportType>('sales');
  protected loading = signal(false);
  protected from = signal('');
  protected to = signal('');

  protected salesRows = signal<SalesReportRow[]>([]);
  protected salesSummary = signal<{ orders: number; revenue: number } | null>(null);
  protected inventoryRows = signal<InventoryReportRow[]>([]);

  ngOnInit(): void {
    this.runReport();
  }

  protected selectType(type: ReportType): void {
    this.reportType.set(type);
    this.runReport();
  }

  protected onFrom(event: Event): void { this.from.set((event.target as HTMLInputElement).value); }
  protected onTo(event: Event): void { this.to.set((event.target as HTMLInputElement).value); }

  protected runReport(): void {
    this.loading.set(true);
    if (this.reportType() === 'sales') {
      this.adminService.getSalesReport(this.from() || undefined, this.to() || undefined).subscribe({
        next: (res) => {
          this.salesRows.set(res.data);
          this.salesSummary.set(res.summary);
          this.loading.set(false);
        },
        error: () => {
          this.loading.set(false);
          this.notification.error('No se pudo generar el reporte de ventas');
        },
      });
    } else {
      this.adminService.getInventoryReport().subscribe({
        next: (res) => {
          this.inventoryRows.set(res.data);
          this.loading.set(false);
        },
        error: () => {
          this.loading.set(false);
          this.notification.error('No se pudo generar el reporte de inventario');
        },
      });
    }
  }

  protected exportCsv(): void {
    const isSales = this.reportType() === 'sales';
    const headers = isSales
      ? ['Pedido', 'Cliente', 'Vendedor', 'Estado', 'Pago', 'Metodo', 'Total', 'Fecha']
      : ['SKU', 'Producto', 'Categoria', 'Stock', 'Alerta', 'Costo', 'Precio', 'Valor stock'];

    const rows = isSales
      ? this.salesRows().map((r) => [
          r.order_number, r.customer_name, r.seller ?? '', ORDER_STATUS_LABELS[r.order_status],
          PAYMENT_STATUS_LABELS[r.payment_status], r.payment_method, r.total_amount, r.order_date,
        ])
      : this.inventoryRows().map((r) => [
          r.sku, r.name, r.category ?? '', r.stock_quantity, r.stock_alert_level,
          r.base_cost, r.price_cash, r.stock_value,
        ]);

    const csv = [headers, ...rows]
      .map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(','))
      .join('\n');

    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `reporte-${this.reportType()}-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
    this.notification.success('Reporte exportado');
  }

  protected printReport(): void {
    window.print();
  }

  protected statusLabel(s: OrderStatus): string { return ORDER_STATUS_LABELS[s]; }
  protected statusTone(s: OrderStatus): string { return ORDER_STATUS_TONE[s]; }
  protected payLabel(s: PaymentStatus): string { return PAYMENT_STATUS_LABELS[s]; }
}
