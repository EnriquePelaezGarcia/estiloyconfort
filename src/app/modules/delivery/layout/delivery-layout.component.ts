import { ChangeDetectionStrategy, Component, OnInit, inject } from '@angular/core';
import {
  BusinessLayoutComponent,
  BusinessNavItem,
} from '../../../shared/components/business-layout/business-layout.component';
import { DiscountsService } from '../../../core/services/discounts.service';

@Component({
  selector: 'app-delivery-layout',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './delivery-layout.component.html',
  styleUrl: './delivery-layout.component.scss',
  imports: [BusinessLayoutComponent],
})
export class DeliveryLayoutComponent implements OnInit {
  private discountsService = inject(DiscountsService);

  protected readonly navItems: BusinessNavItem[] = [
    {
      label: 'Entregas de hoy',
      icon: 'local_shipping',
      route: 'entregas',
      // Docs/plan-descuentos.md: descuentos MÍOS que el admin rechazó y no he visto.
      badge: () => this.discountsService.myRejectedCount() ?? 0,
    },
    { label: 'Historial', icon: 'history', route: 'historial' },
    { label: 'Mis ganancias', icon: 'payments', route: 'ganancias' },
  ];

  ngOnInit(): void {
    this.discountsService.refreshMyRejectedCount().subscribe({ error: () => {} });
  }
}
