import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { environment } from '../../../../environments/environment';
import { ReviewsBadgeComponent } from '../reviews-badge/reviews-badge.component';

@Component({
  selector: 'app-footer',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './footer.component.html',
  styleUrl: './footer.component.scss',
  imports: [RouterLink, ReviewsBadgeComponent],
})
export class FooterComponent {
  protected year = new Date().getFullYear();
  protected readonly whatsappUrl = `https://wa.me/${environment.whatsappNumber}`;
}
