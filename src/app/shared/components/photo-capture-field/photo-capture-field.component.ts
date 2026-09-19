import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { NotificationService } from '../../../core/services/notification.service';

/**
 * Campo de foto reutilizable para el repartidor: cámara en vivo en celular
 * (getUserMedia, sin opción de galería), selector de archivos como respaldo
 * en escritorio o si el navegador no soporta getUserMedia, y conversión
 * HEIC/HEIF → JPEG (foto por defecto de iPhone, que Chrome/Android no puede
 * mostrar). Antes vivía duplicado en la evidencia de entrega y en la
 * evidencia del intento fallido de `delivery-detail.component`; se extrajo
 * aquí al separar esas dos pantallas en rutas distintas.
 *
 * Es un campo controlado: no guarda el dataURL, solo lo emite — el padre
 * decide dónde vive (`photoData`, `failPhotoData`, etc.).
 */
@Component({
  selector: 'app-photo-capture-field',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './photo-capture-field.component.html',
  styleUrl: './photo-capture-field.component.scss',
})
export class PhotoCaptureFieldComponent {
  private notification = inject(NotificationService);

  readonly value = input<string | null>(null);
  /** Entrega ya cerrada: no se puede tomar una nueva foto ni borrar la actual. */
  readonly readonly = input(false);
  readonly valueChange = output<string | null>();

  private fileInputRef = viewChild<ElementRef<HTMLInputElement>>('fileInput');
  private videoRef = viewChild<ElementRef<HTMLVideoElement>>('cameraVideo');

  protected processing = signal(false);
  protected cameraOpen = signal(false);
  private mediaStream: MediaStream | null = null;

  protected isMobileViewport(): boolean {
    return typeof window !== 'undefined' && window.matchMedia('(max-width: 768px)').matches;
  }

  /**
   * En celular abre la cámara en vivo dentro de la app (garantiza foto en
   * directo, sin opción de galería); en escritorio, o si el navegador no
   * soporta getUserMedia / el usuario niega el permiso, cae al selector de
   * archivos nativo como respaldo.
   */
  protected async openCapture(): Promise<void> {
    if (this.readonly()) return;
    if (!this.isMobileViewport() || !navigator.mediaDevices?.getUserMedia) {
      this.fileInputRef()?.nativeElement.click();
      return;
    }
    try {
      this.mediaStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' } },
        audio: false,
      });
      this.cameraOpen.set(true);
      document.body.style.overflow = 'hidden';
      // Espera al render del <video> antes de engancharle el stream.
      setTimeout(() => {
        const video = this.videoRef()?.nativeElement;
        if (!video) return;
        video.srcObject = this.mediaStream;
        video.play().catch(() => {});
      });
    } catch {
      this.notification.error('No se pudo abrir la cámara. Elige una foto desde el teléfono.');
      this.fileInputRef()?.nativeElement.click();
    }
  }

  /** Toma el cuadro actual del video como foto y cierra la cámara. */
  protected capturePhoto(): void {
    const video = this.videoRef()?.nativeElement;
    if (!video || !video.videoWidth) return;
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    this.valueChange.emit(canvas.toDataURL('image/jpeg', 0.9));
    this.closeCamera();
  }

  protected closeCamera(): void {
    this.stopCameraStream();
    this.cameraOpen.set(false);
    document.body.style.overflow = '';
  }

  private stopCameraStream(): void {
    this.mediaStream?.getTracks().forEach((track) => track.stop());
    this.mediaStream = null;
  }

  /**
   * Antes esto sólo leía el archivo con FileReader y lo mostraba tal cual: si
   * el formato no lo podía decodificar el navegador (HEIC de iPhone en
   * Chrome/Android, TIFF, RAW, etc.) quedaba una foto rota sin ningún aviso.
   * Ahora: valida que sea una imagen, convierte HEIC/HEIF a JPEG y confirma
   * que el navegador puede decodificar el resultado antes de aceptarlo.
   */
  protected onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = ''; // permite reintentar con el mismo archivo si falla
    if (!file) return;

    if (!this.isSupportedImageFile(file)) {
      this.notification.error('Ese archivo no es una imagen. Usa JPG, PNG, WEBP o HEIC.');
      return;
    }

    this.processing.set(true);
    this.readImageFile(file)
      .then((dataUrl) => this.verifyImageDecodes(dataUrl))
      .then((dataUrl) => {
        this.valueChange.emit(dataUrl);
        this.processing.set(false);
      })
      .catch((err: unknown) => {
        this.processing.set(false);
        this.notification.error(
          err instanceof Error && err.message
            ? err.message
            : 'No se pudo procesar la foto. Intenta con otra imagen (JPG o PNG).',
        );
      });
  }

  /** HEIC/HEIF = foto por defecto de iPhone; Chrome/Android no la puede mostrar. */
  private isHeic(file: File): boolean {
    const type = file.type.toLowerCase();
    const name = file.name.toLowerCase();
    return type === 'image/heic' || type === 'image/heif' || name.endsWith('.heic') || name.endsWith('.heif');
  }

  private isSupportedImageFile(file: File): boolean {
    return file.type.startsWith('image/') || this.isHeic(file);
  }

  private async readImageFile(file: File): Promise<string> {
    let source: Blob = file;
    if (this.isHeic(file)) {
      const heic2any = (await import('heic2any')).default;
      const converted = await heic2any({ blob: file, toType: 'image/jpeg', quality: 0.9 });
      source = Array.isArray(converted) ? converted[0] : converted;
    }
    return new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => reject(new Error('No se pudo leer el archivo de la foto.'));
      reader.readAsDataURL(source);
    });
  }

  /** Confirma que el navegador puede decodificar/mostrar la imagen antes de aceptarla. */
  private verifyImageDecodes(dataUrl: string): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(dataUrl);
      img.onerror = () =>
        reject(new Error('Este formato de imagen no es compatible con el navegador. Usa JPG, PNG o WEBP.'));
      img.src = dataUrl;
    });
  }

  /** Red de seguridad: una foto ya guardada (de otro navegador/dispositivo) que no se puede decodificar aquí. */
  protected onRenderError(): void {
    this.notification.error('No se pudo mostrar la foto guardada; puede estar en un formato no compatible.');
  }

  protected removePhoto(): void {
    if (this.readonly()) return;
    this.valueChange.emit(null);
  }
}
