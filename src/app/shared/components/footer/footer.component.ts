import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { environment } from '../../../../environments/environment';

@Component({
  selector: 'app-footer',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './footer.component.html',
  styleUrl: './footer.component.scss',
  imports: [RouterLink],
})
export class FooterComponent {
  protected year = new Date().getFullYear();
  protected readonly whatsappUrl = `https://wa.me/${environment.whatsappNumber}`;
}
