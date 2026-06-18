import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { map } from 'rxjs/operators';

@Component({
  selector: 'app-coming-soon',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './coming-soon.component.html',
  styleUrl: './coming-soon.component.scss',
  imports: [RouterLink],
})
export class ComingSoonComponent {
  private route = inject(ActivatedRoute);

  protected routeData = toSignal(
    this.route.data.pipe(map((d) => d as { moduleTitle: string; icon: string; phase: number })),
  );
}
