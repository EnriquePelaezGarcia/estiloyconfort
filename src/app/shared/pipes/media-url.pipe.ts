import { Pipe, PipeTransform } from '@angular/core';
import { mediaUrl, mediaThumbUrl } from '../../core/utils/media-url';

/**
 * `[src]="foto | mediaUrl"` — antepone el origen del API a las rutas que
 * guarda la base. Ver core/utils/media-url.ts para el porqué.
 *
 * `[src]="foto | mediaUrl:'thumb'"` — usa la miniatura (800 px) donde la
 * imagen se pinta chica; cae a la completa para las fotos que aún no son WebP.
 *
 * Es puro: Angular memoiza por argumento y no lo reevalúa en cada ciclo de
 * detección de cambios.
 */
@Pipe({ name: 'mediaUrl' })
export class MediaUrlPipe implements PipeTransform {
  transform(src: string | null | undefined, variant?: 'thumb'): string | null {
    return variant === 'thumb' ? mediaThumbUrl(src) : mediaUrl(src);
  }
}
