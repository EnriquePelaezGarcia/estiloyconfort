import {
  AngularNodeAppEngine,
  createNodeRequestHandler,
  isMainModule,
  writeResponseToNodeResponse,
} from '@angular/ssr/node';
import express from 'express';
import { join } from 'node:path';
import { environment } from './environments/environment';

const browserDistFolder = join(import.meta.dirname, '../browser');

const app = express();
const angularApp = new AngularNodeAppEngine();

/**
 * SEO (Docs/plan-imagen-y-ayuda-por-material.md, Parte 3). robots.txt y
 * sitemap.xml se sirven desde el dominio del sitio — es lo que exige Google —
 * y aquí es donde vive ese dominio (el frontend SSR). No toca nginx ni el
 * backend salvo el endpoint /products/sitemap que alimenta el XML.
 */
const SITE_URL = environment.siteUrl.replace(/\/+$/, '');
const API_URL = environment.apiUrl.replace(/\/+$/, '');

const ROBOTS_TXT = [
  'User-agent: *',
  'Allow: /',
  'Disallow: /admin',
  'Disallow: /vendedor',
  'Disallow: /fabricante',
  'Disallow: /reparto',
  'Disallow: /auth',
  'Disallow: /carrito',
  '',
  `Sitemap: ${SITE_URL}/sitemap.xml`,
  '',
].join('\n');

const STATIC_PATHS = ['/', '/catalogo', '/nosotros', '/contacto'];

let sitemapCache: { xml: string; at: number } | null = null;
const SITEMAP_TTL_MS = 60 * 60 * 1000; // 1 h — los bots no necesitan más fresco

function xmlEscape(s: string): string {
  return s.replace(/[<>&'"]/g, (c) =>
    ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' })[c]!,
  );
}

async function buildSitemap(): Promise<string> {
  const urls: { loc: string; lastmod?: string }[] = STATIC_PATHS.map((p) => ({
    loc: `${SITE_URL}${p}`,
  }));

  try {
    const res = await fetch(`${API_URL}/products/sitemap`, {
      signal: AbortSignal.timeout(8000),
    });
    if (res.ok) {
      const body = (await res.json()) as { data?: { slug: string; updated_at?: string }[] };
      for (const p of body.data ?? []) {
        if (!p.slug) continue;
        urls.push({
          loc: `${SITE_URL}/producto/${encodeURIComponent(p.slug)}`,
          lastmod: p.updated_at ? new Date(p.updated_at).toISOString().slice(0, 10) : undefined,
        });
      }
    }
  } catch {
    // El sitemap con solo las páginas fijas sigue siendo válido.
  }

  const entries = urls
    .map(
      (u) =>
        `  <url><loc>${xmlEscape(u.loc)}</loc>${u.lastmod ? `<lastmod>${u.lastmod}</lastmod>` : ''}</url>`,
    )
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${entries}\n</urlset>\n`;
}

app.get('/robots.txt', (_req, res) => {
  res.type('text/plain').send(ROBOTS_TXT);
});

app.get('/sitemap.xml', async (_req, res, next) => {
  try {
    if (!sitemapCache || Date.now() - sitemapCache.at > SITEMAP_TTL_MS) {
      sitemapCache = { xml: await buildSitemap(), at: Date.now() };
    }
    res.type('application/xml').send(sitemapCache.xml);
  } catch (err) {
    next(err);
  }
});

/**
 * Example Express Rest API endpoints can be defined here.
 * Uncomment and define endpoints as necessary.
 *
 * Example:
 * ```ts
 * app.get('/api/{*splat}', (req, res) => {
 *   // Handle API request
 * });
 * ```
 */

/**
 * Serve static files from /browser
 */
app.use(
  express.static(browserDistFolder, {
    maxAge: '1y',
    index: false,
    redirect: false,
  }),
);

/**
 * Handle all other requests by rendering the Angular application.
 */
app.use((req, res, next) => {
  angularApp
    .handle(req)
    .then((response) =>
      response ? writeResponseToNodeResponse(response, res) : next(),
    )
    .catch(next);
});

/**
 * Start the server if this module is the main entry point, or it is ran via PM2.
 * The server listens on the port defined by the `PORT` environment variable, or defaults to 4000.
 */
if (isMainModule(import.meta.url) || process.env['pm_id']) {
  const port = process.env['PORT'] || 4000;
  app.listen(port, (error) => {
    if (error) {
      throw error;
    }

    console.log(`Node Express server listening on http://localhost:${port}`);
  });
}

/**
 * Request handler used by the Angular CLI (for dev-server and during build) or Firebase Cloud Functions.
 */
export const reqHandler = createNodeRequestHandler(app);
