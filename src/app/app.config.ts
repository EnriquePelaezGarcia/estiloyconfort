import {
  ApplicationConfig,
  inject,
  provideAppInitializer,
  provideBrowserGlobalErrorListeners,
  provideZonelessChangeDetection,
} from '@angular/core';
import { provideRouter, withComponentInputBinding, withViewTransitions } from '@angular/router';
import { provideClientHydration, withEventReplay } from '@angular/platform-browser';
import { provideHttpClient, withFetch, withInterceptors } from '@angular/common/http';
import { provideAnimationsAsync } from '@angular/platform-browser/animations/async';
import { firstValueFrom, catchError, of } from 'rxjs';

import { routes } from './app.routes';
import { jwtInterceptor } from './core/auth/jwt.interceptor';
import { MaterialsStore } from './core/services/materials.store';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideZonelessChangeDetection(),
    provideRouter(routes, withComponentInputBinding(), withViewTransitions()),
    provideClientHydration(withEventReplay()),
    provideHttpClient(withFetch(), withInterceptors([jwtInterceptor])),
    provideAnimationsAsync(),
    // M1: el catálogo de materiales se carga UNA VEZ al arrancar la app,
    // igual que antes era una constante importada. Si el backend no
    // responde, la app arranca igual con el catálogo vacío en vez de
    // bloquear el primer render.
    provideAppInitializer(() => {
      const store = inject(MaterialsStore);
      return firstValueFrom(store.load().pipe(catchError(() => of(null))));
    }),
  ],
};
