import { Injectable, signal } from '@angular/core';

export interface Toast {
  id: number;
  message: string;
  type: 'success' | 'error' | 'info';
}

@Injectable({ providedIn: 'root' })
export class NotificationService {
  readonly toasts = signal<Toast[]>([]);
  private counter = 0;

  private add(message: string, type: Toast['type'], duration: number): void {
    const id = ++this.counter;
    this.toasts.update((t) => [...t, { id, message, type }]);
    setTimeout(() => this.dismiss(id), duration);
  }

  dismiss(id: number): void {
    this.toasts.update((t) => t.filter((x) => x.id !== id));
  }

  success(message: string): void {
    this.add(message, 'success', 4000);
  }

  error(message: string): void {
    this.add(message, 'error', 6000);
  }

  info(message: string): void {
    this.add(message, 'info', 3000);
  }
}
