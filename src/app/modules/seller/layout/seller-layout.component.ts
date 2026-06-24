import { ChangeDetectionStrategy, Component } from '@angular/core';
import {
  BusinessLayoutComponent,
  BusinessNavItem,
} from '../../../shared/components/business-layout/business-layout.component';

@Component({
  selector: 'app-seller-layout',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './seller-layout.component.html',
  styleUrl: './seller-layout.component.scss',
  imports: [BusinessLayoutComponent],
})
export class SellerLayoutComponent {
  protected readonly navItems: BusinessNavItem[] = [
    { label: 'Resumen', icon: 'dashboard', route: 'resumen' },
    { label: 'Nuevo pedido', icon: 'add_shopping_cart', route: 'nuevo' },
    { label: 'Catálogo', icon: 'inventory_2', route: 'catalogo' },
    { label: 'Mis pedidos', icon: 'receipt_long', route: 'pedidos' },
  ];
}
