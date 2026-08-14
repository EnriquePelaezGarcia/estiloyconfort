import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { AuthService } from '../../../core/auth/auth.service';

@Component({
  selector: 'app-navbar',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './navbar.component.html',
  styleUrl: './navbar.component.scss',
  imports: [RouterLink, RouterLinkActive],
  host: {
    '(document:click)': 'closeDropdown()',
    '(document:keydown.escape)': 'closeMobileMenu()',
  },
})
export class NavbarComponent {
  protected auth = inject(AuthService);
  protected mobileMenuOpen = signal(false);
  protected dropdownOpen = signal(false);

  toggleDropdown(event: Event): void {
    event.stopPropagation();
    this.dropdownOpen.update((v) => !v);
  }

  toggleMobileMenu(): void {
    this.mobileMenuOpen.update((v) => !v);
  }

  closeMobileMenu(): void {
    this.mobileMenuOpen.set(false);
  }

  closeDropdown(): void {
    this.dropdownOpen.set(false);
  }
}
