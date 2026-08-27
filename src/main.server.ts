import { BootstrapContext, bootstrapApplication } from '@angular/platform-browser';
import { registerLocaleData } from '@angular/common';
import localeEsMx from '@angular/common/locales/es-MX';
import { App } from './app/app';
import { config } from './app/app.config.server';

// El cliente registra es-MX en main.ts; el render en servidor necesita lo
// mismo para las páginas que formatean fechas en español (p.ej. el rastreador
// de pedidos, que corre en RenderMode.Server).
registerLocaleData(localeEsMx);

const bootstrap = (context: BootstrapContext) =>
    bootstrapApplication(App, config, context);

export default bootstrap;
