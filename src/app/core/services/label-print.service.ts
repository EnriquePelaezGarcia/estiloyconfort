import { Injectable } from '@angular/core';
import * as QRCode from 'qrcode';

/** Datos mínimos para generar la etiqueta de un producto. */
export interface LabelItem {
  name: string;
  sku: string;
  /** Número de etiquetas a imprimir de este producto. */
  copies: number;
}

/**
 * Genera e imprime etiquetas con código QR para identificar los muebles.
 * Cada etiqueta lleva el QR a la izquierda (contiene "SKU | nombre") y el
 * nombre + SKU en texto legible a la derecha.
 *
 * Medidas para Brother QL-810W con etiquetas precortadas DK-11209 (62 × 29 mm):
 * cada etiqueta es una página del rollo. En el diálogo de impresión selecciona
 * la QL-810W con tamaño de papel 62 × 29 mm y márgenes en cero.
 */
@Injectable({ providedIn: 'root' })
export class LabelPrintService {
  /** Abre la ventana de impresión con las etiquetas de los productos indicados. */
  async print(items: LabelItem[]): Promise<void> {
    const printable = items.filter((i) => i.sku && i.copies > 0);
    if (printable.length === 0) return;

    const labels: string[] = [];
    for (const item of printable) {
      const qrDataUrl = await QRCode.toDataURL(`${item.sku} | ${item.name}`, {
        errorCorrectionLevel: 'M',
        margin: 1,
        width: 220,
      });
      const label = `
        <div class="label">
          <img class="label__qr" src="${qrDataUrl}" alt="QR ${this.escape(item.sku)}" />
          <div class="label__text">
            <p class="label__name">${this.escape(item.name)}</p>
            <p class="label__sku">${this.escape(item.sku)}</p>
          </div>
        </div>`;
      for (let i = 0; i < item.copies; i++) labels.push(label);
    }

    const win = window.open('', '_blank', 'width=900,height=700');
    if (!win) return;
    win.document.write(this.buildDocument(labels.join('')));
    win.document.close();
    win.focus();
    // Espera a que carguen las imágenes del QR antes de abrir el diálogo.
    win.onload = () => {
      win.print();
      win.onafterprint = () => win.close();
    };
  }

  private buildDocument(labelsHtml: string): string {
    return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8" />
<title>Etiquetas QR - Estilo y Confort</title>
<style>
  /* Etiqueta DK-11209 (62 × 29 mm): una etiqueta del rollo = una página. */
  @page { size: 62mm 29mm; margin: 0; }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: Arial, Helvetica, sans-serif; }
  .label {
    display: flex;
    align-items: center;
    gap: 2mm;
    width: 62mm;
    height: 29mm;
    padding: 1.5mm 2mm;
    overflow: hidden;
    page-break-after: always;
    page-break-inside: avoid;
  }
  .label__qr { width: 25mm; height: 25mm; flex-shrink: 0; }
  .label__text { min-width: 0; }
  .label__name {
    font-size: 9pt;
    font-weight: 700;
    line-height: 1.15;
    text-transform: uppercase;
    display: -webkit-box;
    -webkit-line-clamp: 3;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }
  .label__sku {
    margin-top: 1mm;
    font-family: 'Courier New', monospace;
    font-size: 8.5pt;
    font-weight: 700;
    letter-spacing: 0.02em;
    word-break: break-all;
  }
  /* Borde guía sólo en pantalla, para previsualizar; no se imprime. */
  @media screen {
    body { padding: 8mm; background: #f3f4f6; }
    .label { border: 1px dashed #999; border-radius: 2mm; background: #fff; margin-bottom: 4mm; }
  }
</style>
</head>
<body>${labelsHtml}</body>
</html>`;
  }

  private escape(value: string): string {
    return value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
}
