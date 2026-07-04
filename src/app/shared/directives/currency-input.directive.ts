import {
  AfterViewInit,
  Directive,
  ElementRef,
  OnDestroy,
  forwardRef,
  inject,
} from '@angular/core';
import { ControlValueAccessor, NG_VALUE_ACCESSOR } from '@angular/forms';

@Directive({
  selector: 'input[appCurrencyInput]',
  providers: [
    {
      provide: NG_VALUE_ACCESSOR,
      useExisting: forwardRef(() => CurrencyInputDirective),
      multi: true,
    },
  ],
  host: {
    '(input)': 'onInput($event)',
    '(blur)': 'onBlur()',
  },
})
export class CurrencyInputDirective
  implements ControlValueAccessor, AfterViewInit, OnDestroy
{
  private readonly el = inject(ElementRef<HTMLInputElement>);

  private _onChange: (v: number | null) => void = () => {};
  private _onTouched: () => void = () => {};
  private _numeric: number | null = null;

  // ── ControlValueAccessor ──────────────────────────────────────────────────

  writeValue(value: number | null): void {
    this._numeric = value ?? null;
    this._setDisplay(this._format(this._numeric));
  }

  registerOnChange(fn: (v: number | null) => void): void {
    this._onChange = fn;
  }

  registerOnTouched(fn: () => void): void {
    this._onTouched = fn;
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  ngAfterViewInit(): void {
    // With @for + OnPush, writeValue may run before the browser has painted the
    // element; re-applying here guarantees the formatted text is visible on first paint.
    this._setDisplay(this._format(this._numeric));
  }

  ngOnDestroy(): void {}

  // ── Host events ───────────────────────────────────────────────────────────

  onInput(event: Event): void {
    const input = event.target as HTMLInputElement;
    const cursorPos = input.selectionStart ?? 0;
    const raw = input.value;

    // Count numeric chars before the cursor so we can restore the position.
    const numericBefore = raw.slice(0, cursorPos).replace(/[^0-9.]/g, '').length;

    // Strip non-numeric, keep only the first decimal point.
    const stripped = raw.replace(/[^0-9.]/g, '');
    const dotAt = stripped.indexOf('.');
    const clean =
      dotAt >= 0
        ? stripped.slice(0, dotAt + 1) + stripped.slice(dotAt + 1).replace(/\./g, '')
        : stripped;

    const parsed = clean === '' || clean === '.' ? NaN : parseFloat(clean);
    this._numeric = isNaN(parsed) ? null : parsed;
    this._onChange(this._numeric);

    const formatted = this._formatLive(clean);
    this._setDisplay(formatted);

    const newPos = this._cursorAfterN(formatted, numericBefore);
    input.setSelectionRange(newPos, newPos);
  }

  onBlur(): void {
    this._onTouched();
    this._setDisplay(this._format(this._numeric));
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  private _setDisplay(value: string): void {
    const el = this.el.nativeElement;
    if (el.value !== value) el.value = value;
  }

  private _cursorAfterN(text: string, n: number): number {
    let count = 0;
    let pos = 0;
    for (let i = 0; i < text.length; i++) {
      if (/[0-9.]/.test(text[i])) {
        if (count === n) break;
        count++;
      }
      pos = i + 1;
    }
    return pos;
  }

  private _formatLive(clean: string): string {
    if (!clean) return '';
    const dotAt = clean.indexOf('.');
    const hasDecimal = dotAt >= 0;
    const intStr = hasDecimal ? clean.slice(0, dotAt) : clean;
    const decStr = hasDecimal ? clean.slice(dotAt + 1, dotAt + 3) : '';
    const withCommas = (intStr || '0').replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    const prefix = '$' + withCommas;
    return hasDecimal ? `${prefix}.${decStr}` : prefix;
  }

  private _format(value: number | null): string {
    if (value === null) return '';
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(value);
  }
}
