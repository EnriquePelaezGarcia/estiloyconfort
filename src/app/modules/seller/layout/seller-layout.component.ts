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
    { label: 'Cotizaciones', icon: 'request_quote', route: 'cotizaciones' },
    { label: 'Catálogo', icon: 'inventory_2', route: 'catalogo' },
    { label: 'Todos los pedidos', icon: 'receipt_long', route: 'pedidos' },
    { label: 'Crédito y Apartado', icon: 'credit_card', route: 'clientes-credito' },
    { label: 'Reservas', icon: 'bookmark', route: 'reservas' },
  ];
}
