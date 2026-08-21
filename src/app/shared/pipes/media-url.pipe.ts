import { Pipe, PipeTransform } from '@angular/core';
import { mediaUrl } from '../../core/utils/media-url';

/**
 * `[src]="foto | mediaUrl"` — antepone el origen del API a las rutas que
 * guarda la base. Ver core/utils/media-url.ts para el porqué.
 *
 * Es puro: Angular memoiza por argumento y no lo reevalúa en cada ciclo de
 * detección de cambios.
 */
@Pipe({ name: 'mediaUrl' })
export class MediaUrlPipe implements PipeTransform {
  transform(src: string | null | undefined): string | null {
    return mediaUrl(src);
  }
}
