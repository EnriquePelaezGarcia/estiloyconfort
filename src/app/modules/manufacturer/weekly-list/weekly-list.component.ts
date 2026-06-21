import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { ManufacturerService } from '../../../core/services/manufacturer.service';
import { NotificationService } from '../../../core/services/notification.service';
import { WeeklyListRow } from '../../../core/models/order.model';

@Component({
  selector: 'app-weekly-list',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './weekly-list.component.html',
  styleUrl: './weekly-list.component.scss',
  imports: [DatePipe],
})
export class WeeklyListComponent implements OnInit {
  private manufacturerService = inject(ManufacturerService);
  private notification = inject(NotificationService);

  protected rows = signal<WeeklyListRow[]>([]);
  protected loading = signal(true);
  protected readonly today = new Date();

  protected totalUnits = computed(() => this.rows().reduce((s, r) => s + r.totalQuantity, 0));

  ngOnInit(): void {
    this.manufacturerService.getWeeklyList().subscribe({
      next: (res) => {
        this.rows.set(res.data);
        this.loading.set(false);
      },
      error: () => {
        this.loading.set(false);
        this.notification.error('No se pudo cargar la lista semanal');
      },
    });
  }

  protected downloadPdf(): void {
    window.print();
  }
}
