import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { NavigationEnd, Router, RouterOutlet } from '@angular/router';
import { filter } from 'rxjs/operators';
import { NavbarComponent } from './shared/components/navbar/navbar.component';
import { FooterComponent } from './shared/components/footer/footer.component';
import { LoaderComponent } from './shared/components/loader/loader.component';
import { ToastComponent } from './shared/components/toast/toast.component';

// Rutas de paneles internos que usan su propio layout (sin navbar/footer público).
const DASHBOARD_PREFIXES = ['/admin', '/vendedor', '/repartidor', '/fabricante'];

@Component({
  selector: 'app-root',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterOutlet, NavbarComponent, FooterComponent, LoaderComponent, ToastComponent],
  templateUrl: './app.html',
  styleUrl: './app.scss',
})
export class App {
  private router = inject(Router);

  protected showPublicChrome = signal(!this.isDashboardRoute(this.router.url));

  constructor() {
    this.router.events
      .pipe(filter((e): e is NavigationEnd => e instanceof NavigationEnd))
      .subscribe((e) => this.showPublicChrome.set(!this.isDashboardRoute(e.urlAfterRedirects)));
  }

  private isDashboardRoute(url: string): boolean {
    return DASHBOARD_PREFIXES.some((p) => url === p || url.startsWith(`${p}/`));
  }
}
