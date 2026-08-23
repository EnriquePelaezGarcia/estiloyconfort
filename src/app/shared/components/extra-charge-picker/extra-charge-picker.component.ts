import { ChangeDetectionStrategy, Component, output, signal } from '@angular/core';

/**
 * Mini-formulario para capturar un cargo extra por modificación al mueble
 * (Docs/plan-aprobaciones-admin.md RN-EC2) — ej. "Cambiar focos a LED —
 * $1,200". Presentacional a propósito, igual que
 * `DiscountReasonPickerComponent`: quien lo usa decide dónde vive el estado
 * (punto de venta, cotizaciones y el detalle de pedido lo usan por separado).
 *
 * D5: se muestra solo cuando el padre decide abrirlo (clic en "+ cargo
 * extra") — este componente no aporta ningún peso visual mientras está cerrado.
 */
@Component({
  selector: 'app-extra-charge-picker',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './extra-charge-picker.component.html',
  styleUrl: './extra-charge-picker.component.scss',
})
export class ExtraChargePickerComponent {
  readonly added = output<{ label: string; amount: number }>();
  readonly cancelled = output<void>();

  protected readonly suggestions = ['Focos LED', 'Cajones extra', 'Cambio de espejo', 'Paquete cumpleañero'];
  protected readonly label = signal('');
  protected readonly amount = signal<number | null>(null);

  protected pick(suggestion: string): void {
    this.label.set(suggestion);
  }

  protected onLabelInput(event: Event): void {
    this.label.set((event.target as HTMLInputElement).value);
  }

  protected onAmountInput(event: Event): void {
    const raw = (event.target as HTMLInputElement).value;
    const value = Number(raw);
    this.amount.set(raw === '' || Number.isNaN(value) || value <= 0 ? null : value);
  }

  protected canAdd(): boolean {
    return this.label().trim().length > 0 && (this.amount() ?? 0) > 0;
  }

  protected confirm(): void {
    if (!this.canAdd()) return;
    this.added.emit({ label: this.label().trim(), amount: this.amount()! });
    this.label.set('');
    this.amount.set(null);
  }

  protected cancel(): void {
    this.label.set('');
    this.amount.set(null);
    this.cancelled.emit();
  }
}
