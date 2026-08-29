import { environment } from '../../../environments/environment';

/**
 * Resolución de rutas de archivos servidos por el backend (/uploads/...).
 *
 * POR QUÉ EXISTE: el backend guardaba en la base la URL absoluta con el host
 * desde el que se subía el archivo, así que una foto cargada en local quedaba
 * como `http://localhost:3000/uploads/...` y moría al desplegar. Ahora la base
 * guarda solo la ruta (`/uploads/products/x.jpg`) y el origen lo pone el
 * frontend en tiempo de render, según el ambiente.
 *
 * NO BASTA CON DEJAR LA RUTA RELATIVA A SECAS: el sitio y el API viven en
 * dominios distintos (estiloyconfortm.com contra api.estiloyconfortm.com, ver
 * deploy/nginx/conf.d/production.conf), así que `/uploads/x.jpg` a pelo lo
 * pediría el navegador al dominio del frontend, donde no está.
 */

/**
 * ALTERNATIVA NO TOMADA: se podría servir /uploads/ también desde el dominio
 * del sitio (un `location /uploads/` en los bloques de estiloyconfortm.com de
 * deploy/nginx/conf.d/*.conf, hoy solo presentes en los de api.). Entonces
 * bastaría devolver la ruta tal cual y las fotos irían al mismo origen que la
 * página, sin CORS. Se prefirió resolver aquí porque no exige tocar el
 * servidor. Si algún día se agrega ese `location`, este archivo es lo único
 * que hay que cambiar: API_ORIGIN pasa a ser ''.
 */

/** El API cuelga de `<origen>/api`; /uploads cuelga del mismo origen. */
const API_ORIGIN = environment.apiUrl.replace(/\/api\/?$/, '');

/** Absoluta heredada: cualquier host + una ruta /uploads/... */
const LEGACY_ABSOLUTE = /^https?:\/\/[^/]+(\/uploads\/.*)$/i;

/**
 * Devuelve la URL lista para un `<img src>`, o null si no hay imagen.
 *
 * Deja pasar intactas las URLs externas (la foto del hero vive en un CDN de
 * Google) y los data: URI.
 */
export function mediaUrl(src: string | null | undefined): string | null {
  if (!src) return null;
  if (src.startsWith('data:')) return src;

  // Filas anteriores a la migración, y carritos ya guardados en el
  // localStorage de un cliente: se les respeta la ruta y se repuntan al API
  // del ambiente actual, en vez de dejarlas rotas.
  const legacy = LEGACY_ABSOLUTE.exec(src);
  if (legacy) return `${API_ORIGIN}${legacy[1]}`;

  if (/^https?:\/\//i.test(src)) return src;

  return `${API_ORIGIN}${src.startsWith('/') ? '' : '/'}${src}`;
}

/**
 * URL de la miniatura para donde la imagen se pinta chica (tarjetas del
 * catálogo, líneas de carrito/pedido/cotización, tiras de miniaturas). El
 * backend guarda `<base>.webp` y, junto a él, `<base>-thumb.webp` (800 px)
 * para toda imagen que sube por multer —producto y categoría—; ver processImage
 * en backend/src/middleware/upload.js.
 *
 * Solo se deriva para rutas locales `.webp`, que son las subidas nuevas y sí
 * tienen miniatura en disco. Para el resto —filas viejas `.jpg/.png`, URLs
 * externas, data: URI— devuelve la imagen completa, así nada se rompe mientras
 * no se hayan resubido todas las fotos.
 */
export function mediaThumbUrl(src: string | null | undefined): string | null {
  if (src && !/^https?:\/\//i.test(src) && !src.startsWith('data:') && /\.webp$/i.test(src)) {
    return mediaUrl(src.replace(/\.webp$/i, '-thumb.webp'));
  }
  return mediaUrl(src);
}
