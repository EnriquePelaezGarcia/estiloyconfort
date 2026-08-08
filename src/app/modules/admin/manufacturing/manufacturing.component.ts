import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';

interface Tab {
  label: string;
  icon: string;
  route: string;
}

@Component({
  selector: 'app-manufacturing',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './manufacturing.component.html',
  styleUrl: './manufacturing.component.scss',
  imports: [RouterLink, RouterLinkActive, RouterOutlet],
})
export class ManufacturingComponent {
  protected readonly tabs: Tab[] = [
    { label: 'Fabricantes', icon: 'store', route: 'fabricantes' },
    { label: 'Órdenes de compra', icon: 'receipt_long', route: 'ordenes-compra' },
    { label: 'Pedidos a fábrica', icon: 'factory', route: 'pedidos-fabrica' },
    { label: 'Catálogo por fabricante', icon: 'inventory_2', route: 'catalogo' },
  ];
}
