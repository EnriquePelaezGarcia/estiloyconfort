/**
 * Prepara un archivo de imagen para subirlo al backend.
 *
 * El binario de `sharp` del servidor no decodifica HEIC/HEIF (el formato por
 * defecto de la cámara del iPhone), así que se convierten a JPEG en el navegador
 * antes de subir — igual que en el módulo de reparto. El resto de formatos
 * (jpeg, png, webp, gif, avif) los procesa `sharp` sin ayuda.
 */

export function isHeic(file: File): boolean {
  const type = file.type.toLowerCase();
  const name = file.name.toLowerCase();
  return (
    type === 'image/heic'
    || type === 'image/heif'
    || name.endsWith('.heic')
    || name.endsWith('.heif')
  );
}

export function isSupportedImageFile(file: File): boolean {
  return file.type.startsWith('image/') || isHeic(file);
}

/** Devuelve el archivo tal cual, o un Blob JPEG si venía en HEIC/HEIF. */
export async function toUploadableImage(file: File): Promise<File | Blob> {
  if (!isHeic(file)) return file;
  const heic2any = (await import('heic2any')).default;
  const converted = await heic2any({ blob: file, toType: 'image/jpeg', quality: 0.9 });
  return Array.isArray(converted) ? converted[0] : converted;
}
