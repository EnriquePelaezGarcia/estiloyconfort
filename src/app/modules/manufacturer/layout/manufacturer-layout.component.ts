import { ChangeDetectionStrategy, Component } from '@angular/core';
import {
  BusinessLayoutComponent,
  BusinessNavItem,
} from '../../../shared/components/business-layout/business-layout.component';

@Component({
  selector: 'app-manufacturer-layout',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './manufacturer-layout.component.html',
  styleUrl: './manufacturer-layout.component.scss',
  imports: [BusinessLayoutComponent],
})
export class ManufacturerLayoutComponent {
  protected readonly navItems: BusinessNavItem[] = [
    { label: 'Lista semanal', icon: 'list_alt', route: 'lista-semanal' },
    { label: 'Pedidos a fabricar', icon: 'precision_manufacturing', route: 'pedidos' },
    { label: 'Mis precios', icon: 'payments', route: 'mis-precios' },
  ];
}
