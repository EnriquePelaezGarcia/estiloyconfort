import { ChangeDetectionStrategy, Component } from '@angular/core';
import {
  BusinessLayoutComponent,
  BusinessNavItem,
} from '../../../shared/components/business-layout/business-layout.component';

@Component({
  selector: 'app-delivery-layout',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './delivery-layout.component.html',
  styleUrl: './delivery-layout.component.scss',
  imports: [BusinessLayoutComponent],
})
export class DeliveryLayoutComponent {
  protected readonly navItems: BusinessNavItem[] = [
    { label: 'Entregas de hoy', icon: 'local_shipping', route: 'entregas' },
    { label: 'Historial', icon: 'history', route: 'historial' },
  ];
}
