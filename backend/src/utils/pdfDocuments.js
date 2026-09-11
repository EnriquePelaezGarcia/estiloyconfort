const path = require('path');
const PDFDocument = require('pdfkit');
const sharp = require('sharp');
const { readStoredFile } = require('./fileStorage');

/**
 * PDFs administrativos para fabricantes: recibo de pago (por cada corte) y
 * estado de cuenta (historial acumulado por periodo). Generados en el
 * servidor con `pdfkit` (JS puro, sin Chromium) para poder archivarlos en
 * disco y adjuntarlos a un correo — ver utils/fileStorage.js y utils/mailer.js.
 *
 * ── DISEÑO ────────────────────────────────────────────────────────────────
 * Papelería de una mueblería boutique, no una factura de software genérica:
 * el morado de marca (mismo #4B3554 que ya usa mailer.js) para jerarquía, el
 * taupe del ornamento de la luna del logotipo (muestreado del PNG real) para
 * las reglas estructurales, y Playfair Display —la serif del logotipo— para
 * el título y los montos que importan; el resto del detalle va en Helvetica
 * para que las tablas se lean como una tabla, no como un poema.
 */

// ─── MARCA ────────────────────────────────────────────────────────────────
// Morado exacto del logotipo — igual que mailer.js, una sola fuente de verdad
// de marca entre el correo y el PDF.
const INK = '#4B3554'; // título, folio, montos grandes
const INK_SOFT = '#2A2230'; // cuerpo (no negro puro: más cálido sobre el papel)
const TAUPE = '#B5ADA6'; // muestreado del ornamento de la luna del logo
const TAUPE_TEXT = '#8B8178'; // taupe oscurecido, legible en tamaños chicos
const PAPER = '#FDFCFA'; // fondo cálido, no blanco puro
const CALLOUT_BG = '#F6F3F9'; // misma lavanda del correo
const CALLOUT_BORDER = '#E4DCEA';

const PAGE_MARGIN = 50;
const PAGE_WIDTH = 612; // carta
const CONTENT_RIGHT = PAGE_WIDTH - PAGE_MARGIN;
const CONTENT_WIDTH = CONTENT_RIGHT - PAGE_MARGIN;

const LOGO_PATH = path.join(__dirname, '..', 'assets', 'email-logo.png');
const LOGO_ASPECT = 129 / 440; // dimensiones reales de email-logo.png

const FONT_DIR = path.join(__dirname, '..', 'assets', 'fonts');
const SERIF_BOLD = path.join(FONT_DIR, 'PlayfairDisplay-Bold.ttf');
const SERIF_REGULAR = path.join(FONT_DIR, 'PlayfairDisplay-Regular.ttf');

// ─── DATOS FISCALES DEL EMISOR ──────────────────────────────────────────────
// Lo que el fabricante necesita para emitirle el CFDI a la tienda por lo que
// se le pagó aquí. Es fijo (mismo receptor en todos los documentos), por eso
// vive como constante y no como algo que se le pasa a cada PDF. Los datos
// deben coincidir tal cual con el registro del SAT — no se "corrige"
// ortografía/acentos de la razón social ni se inventa un código de régimen
// que no se dio.
const FISCAL = {
  razonSocial: 'Enrique Pelaez Garcia',
  rfc: 'PEGE980312SU8',
  direccion: 'Calle 106 Oriente 12, int. 1, Col. Bosques de Santa Anita, '
    + 'C.P. 72227, Puebla, Puebla, México',
};

const PAYMENT_METHOD_LABELS = { cash: 'Efectivo', transfer: 'Transferencia', check: 'Cheque' };

function methodLabel(method) {
  return PAYMENT_METHOD_LABELS[method] || method || '—';
}

function money(amount) {
  return `$${Number(amount || 0).toLocaleString('es-MX', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function dateFmt(value) {
  if (!value) return '—';
  // Un DATE plano ('2026-09-01', sin hora) lo interpreta `new Date()` como
  // medianoche UTC; en un servidor con TZ detrás de UTC (America/Mexico_City,
  // ver Dockerfile) eso se recorre un día al mostrarlo en hora local. Los
  // periodos de createStatement llegan así (strings 'YYYY-MM-DD'), así que se
  // leen los componentes a mano en vez de pasar por Date — igual que ya
  // resuelve Angular DatePipe del lado del front (ver payable-detail.html).
  if (typeof value === 'string') {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
    if (m) return `${Number(m[3])}/${Number(m[2])}/${m[1]}`;
  }
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? String(value) : d.toLocaleDateString('es-MX');
}

/** Junta los chunks que va emitiendo pdfkit en un solo Buffer. */
function collectBuffer(doc) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });
}

/**
 * Documento nuevo con las fuentes de marca registradas. Si el TTF no está
 * (entorno sin `backend/src/assets/fonts/`), cae a Times-Roman: sigue siendo
 * una serif, el documento no se rompe por un asset faltante — mismo criterio
 * defensivo que el logo embebido de mailer.js.
 */
function newDoc() {
  const doc = new PDFDocument({ size: 'letter', margin: PAGE_MARGIN });
  try {
    doc.registerFont('Serif-Bold', SERIF_BOLD);
    doc.registerFont('Serif-Regular', SERIF_REGULAR);
  } catch {
    doc.registerFont('Serif-Bold', 'Times-Bold');
    doc.registerFont('Serif-Regular', 'Times-Roman');
  }
  // Fondo cálido de página completa, no blanco de pantalla — se pinta antes
  // que nada porque `rect().fill()` cubriría cualquier contenido posterior.
  doc.rect(0, 0, PAGE_WIDTH, doc.page.height).fill(PAPER);
  // Listón morado superior: el mismo acento de 6px que abre el header de los
  // correos de mailer.js — un mismo gesto de marca en los dos canales.
  doc.rect(0, 0, PAGE_WIDTH, 6).fill(INK);
  doc.fillColor(INK_SOFT);
  return doc;
}

/**
 * Encabezado tipo membrete: el logotipo a la izquierda (ya trae el nombre
 * completo dibujado) y, alineado a la derecha, la identidad del documento
 * —qué es y su folio— en vez del clásico "logo arriba, todo lo demás abajo".
 * Devuelve el cursor Y donde puede seguir dibujando el llamador.
 */
function drawHeader(doc, docTypeLabel, folio) {
  const top = PAGE_MARGIN;
  const logoWidth = 150;
  const logoHeight = logoWidth * LOGO_ASPECT;
  try {
    doc.image(LOGO_PATH, PAGE_MARGIN, top, { width: logoWidth });
  } catch {
    // Sin el archivo el documento se genera igual, solo sin logo (defensivo,
    // mismo criterio que mailer.js).
  }

  const idWidth = 260;
  const idX = CONTENT_RIGHT - idWidth;
  doc
    .font('Helvetica-Bold')
    .fontSize(9)
    .fillColor(TAUPE_TEXT)
    .text(docTypeLabel.toUpperCase(), idX, top + 4, {
      width: idWidth, align: 'right', characterSpacing: 1.2,
    });
  doc
    .font('Serif-Bold')
    .fontSize(19)
    .fillColor(INK)
    .text(folio, idX, top + 17, { width: idWidth, align: 'right' });

  return top + Math.max(logoHeight, 48) + 18;
}

/**
 * La firma visual del documento: una regla partida con tres puntos taupe al
 * centro, eco discreto de las chispas de cuatro picos del logotipo — separa
 * cada bloque del documento con el mismo gesto en vez de una simple línea.
 */
function drawDivider(doc, y) {
  const gapHalf = 22;
  const midX = PAGE_MARGIN + CONTENT_WIDTH / 2;
  doc.strokeColor(TAUPE).lineWidth(0.75);
  doc.moveTo(PAGE_MARGIN, y).lineTo(midX - gapHalf, y).stroke();
  doc.moveTo(midX + gapHalf, y).lineTo(CONTENT_RIGHT, y).stroke();
  doc.fillColor(TAUPE);
  for (const dx of [-9, 0, 9]) {
    doc.circle(midX + dx, y, 1.4).fill();
  }
  doc.fillColor(INK_SOFT);
  return y + 22;
}

/**
 * Etiqueta pequeña versalita-taupe + valor, la unidad del bloque de datos.
 * Devuelve el alto real que ocupó (una referencia o nota larga envuelve a más
 * de una línea): el llamador avanza el cursor con ese alto, no con uno fijo,
 * para que un valor largo nunca pise la fila siguiente.
 */
function drawField(doc, x, y, width, label, value) {
  doc
    .font('Helvetica-Bold').fontSize(8).fillColor(TAUPE_TEXT)
    .text(label.toUpperCase(), x, y, { width, characterSpacing: 1 });
  doc.font('Helvetica').fontSize(11).fillColor(INK_SOFT);
  const text = value ?? '—';
  const valueHeight = doc.heightOfString(text, { width });
  doc.text(text, x, y + 12, { width });
  return 12 + valueHeight + 10;
}

/** Título de sección: versalita taupe con el peso de un subtítulo, no de una tabla. */
function drawSectionLabel(doc, y, text) {
  doc
    .font('Helvetica-Bold').fontSize(8.5).fillColor(TAUPE_TEXT)
    .text(text.toUpperCase(), PAGE_MARGIN, y, { width: CONTENT_WIDTH, characterSpacing: 1 });
  return y + 16;
}

/**
 * Un renglón de libro mayor: folio/fecha a la izquierda, monto tabular a la
 * derecha, con una micro-línea taupe debajo — sin celdas ni fondos de tabla.
 */
function ledgerRow(doc, y, { left, sub, right, rightColor = INK_SOFT }) {
  // Alto dinámico: una referencia u OC con notas largas de otro modo pisaría
  // el renglón siguiente (mismo criterio que drawField).
  const leftWidth = CONTENT_WIDTH - 140;
  doc.font('Helvetica-Bold').fontSize(10.5).fillColor(INK_SOFT);
  const leftHeight = doc.heightOfString(left, { width: leftWidth });
  doc.text(left, PAGE_MARGIN, y, { width: leftWidth });
  let subHeight = 0;
  if (sub) {
    doc.font('Helvetica').fontSize(9).fillColor(TAUPE_TEXT);
    subHeight = doc.heightOfString(sub, { width: leftWidth }) + 2;
    doc.text(sub, PAGE_MARGIN, y + leftHeight + 2, { width: leftWidth });
  }
  doc.font('Helvetica').fontSize(11).fillColor(rightColor)
    .text(right, PAGE_MARGIN, y, { width: CONTENT_WIDTH, align: 'right' });
  const rowH = leftHeight + subHeight + 10;
  doc.strokeColor(CALLOUT_BORDER).lineWidth(0.5)
    .moveTo(PAGE_MARGIN, y + rowH - 4).lineTo(CONTENT_RIGHT, y + rowH - 4).stroke();
  return y + rowH;
}

/**
 * Miniatura de un producto para el detalle de "Documentos cubiertos". Las
 * fotos del catálogo son WebP (ver middleware/upload.js) y pdfkit solo sabe
 * incrustar JPEG/PNG — se reconvierte con sharp (ya es dependencia del
 * backend) a un PNG cuadrado chico. Si el archivo no existe o no es una
 * imagen válida, devuelve null y la fila cae al placeholder — una foto
 * faltante nunca debe tumbar la generación del recibo.
 */
async function loadThumbnail(imageUrl) {
  if (!imageUrl) return null;
  try {
    const raw = readStoredFile(imageUrl);
    return await sharp(raw).resize(72, 72, { fit: 'cover' }).png().toBuffer();
  } catch {
    return null;
  }
}

/**
 * Una pieza dentro de un documento (OC o pedido): miniatura del producto +
 * cantidad × nombre. Indentada respecto al folio del documento, para leerse
 * como su detalle y no como otro documento más.
 */
function itemRow(doc, y, { thumb, quantity, productName, color }) {
  const size = 26;
  const indent = PAGE_MARGIN + 16;
  const textX = indent + size + 8;
  const textWidth = CONTENT_RIGHT - textX;
  // El color va delante del producto ("1× Nogal — Vanity..."): es lo primero
  // que el fabricante necesita distinguir cuando el mismo mueble se pidió en
  // más de un acabado dentro de la misma OC/pedido.
  const label = color ? `${quantity}× ${color} — ${productName}` : `${quantity}× ${productName}`;

  doc.font('Helvetica').fontSize(9.5).fillColor(INK_SOFT);
  const textHeight = doc.heightOfString(label, { width: textWidth });
  const rowH = Math.max(size, textHeight) + 8;

  if (thumb) {
    try {
      doc.image(thumb, indent, y, { width: size, height: size });
    } catch {
      // Buffer corrupto pese a la conversión — se omite, no se rompe el PDF.
    }
  } else {
    // Placeholder discreto (producto nuevo de una OC, sin foto en BD nunca):
    // un marco vacío para que la fila no "brinque" de tamaño sin la miniatura.
    doc.roundedRect(indent, y, size, size, 3).lineWidth(0.5).strokeColor(CALLOUT_BORDER).stroke();
  }
  doc.font('Helvetica').fontSize(9.5).fillColor(INK_SOFT)
    .text(label, textX, y + (size - textHeight) / 2, { width: textWidth });

  return y + rowH;
}

function emptyRow(doc, y, text) {
  doc.font('Helvetica-Oblique').fontSize(9.5).fillColor(TAUPE_TEXT).text(text, PAGE_MARGIN, y);
  return y + 20;
}

/** El momento ceremonial del documento: el total, en una banda lavanda. */
function drawTotalBand(doc, y, label, amount, height = 46) {
  doc.roundedRect(PAGE_MARGIN, y, CONTENT_WIDTH, height, 4)
    .fillAndStroke(CALLOUT_BG, CALLOUT_BORDER);
  doc.font('Helvetica-Bold').fontSize(9).fillColor(INK)
    .text(label.toUpperCase(), PAGE_MARGIN + 18, y + height / 2 - 5, { characterSpacing: 1 });
  doc.font('Serif-Bold').fontSize(21).fillColor(INK)
    .text(money(amount), PAGE_MARGIN, y + height / 2 - 13, {
      width: CONTENT_WIDTH - 18, align: 'right',
    });
  return y + height + 20;
}

/**
 * Tarjeta de referencia con los datos fiscales del emisor —lo que el
 * fabricante necesita para facturarle a la tienda—, en un marco propio para
 * que se lea como un anexo de consulta y no se confunda con el resto del
 * documento. Mide el alto real de cada valor ANTES de dibujar el marco (dos
 * pasadas): si no, no se sabría qué tan alto pintar la caja.
 */
function drawFiscalBlock(doc, y) {
  const padX = 14;
  const labelWidth = 95;
  const valueX = PAGE_MARGIN + padX + labelWidth + 10;
  const valueWidth = CONTENT_WIDTH - padX * 2 - labelWidth - 10;
  const rows = [
    ['Razón social', FISCAL.razonSocial],
    ['RFC', FISCAL.rfc],
    ['Domicilio fiscal', FISCAL.direccion],
  ];

  doc.font('Helvetica').fontSize(8.5);
  const rowGap = 6;
  const rowHeights = rows.map(([, value]) => Math.max(doc.heightOfString(value, { width: valueWidth }), 10));
  const titleH = 26;
  const boxHeight = titleH + rowHeights.reduce((s, h) => s + h + rowGap, 0) + 6;

  doc.roundedRect(PAGE_MARGIN, y, CONTENT_WIDTH, boxHeight, 4)
    .lineWidth(0.75).strokeColor(TAUPE).stroke();
  // No es la factura del fabricante, es lo que ÉL necesita para hacérsela AL
  // CLIENTE (la tienda) por lo que aquí se le está pagando — de ahí "del
  // cliente", no "tu factura" a secas (que sonaba a la factura del propio
  // fabricante).
  doc.font('Helvetica-Bold').fontSize(8).fillColor(INK)
    .text('DATOS FISCALES DEL CLIENTE — PARA TU CFDI', PAGE_MARGIN + padX, y + 12, {
      width: CONTENT_WIDTH - padX * 2, characterSpacing: 1,
    });

  let cursor = y + titleH;
  rows.forEach(([label, value], i) => {
    doc.font('Helvetica-Bold').fontSize(7.5).fillColor(TAUPE_TEXT)
      .text(label.toUpperCase(), PAGE_MARGIN + padX, cursor + 1, { width: labelWidth, characterSpacing: 0.5 });
    doc.font('Helvetica').fontSize(8.5).fillColor(INK_SOFT)
      .text(value, valueX, cursor, { width: valueWidth });
    cursor += rowHeights[i] + rowGap;
  });

  return y + boxHeight + 20;
}

function drawFooter(doc, lines) {
  // Pegado al contenido, no clavado al fondo de la hoja: un recibo de una
  // sola línea no debe dejar media página en blanco antes del pie.
  const y = doc.y + 14;
  doc.strokeColor(CALLOUT_BORDER).lineWidth(0.5)
    .moveTo(PAGE_MARGIN, y).lineTo(CONTENT_RIGHT, y).stroke();
  doc.font('Helvetica-Oblique').fontSize(8).fillColor(TAUPE_TEXT)
    .text(lines.join('  ·  '), PAGE_MARGIN, y + 8, { width: CONTENT_WIDTH });
}

/**
 * Recibo de un pago (= un corte) a un fabricante — ver
 * ManufacturerPayable.findBatch para la forma de `batch`.
 */
async function buildPaymentReceiptPdf(batch, receiptNumber) {
  const doc = newDoc();
  const buffer = collectBuffer(doc);

  let y = drawHeader(doc, 'Recibo de pago a fabricante', receiptNumber);
  y = drawDivider(doc, y);

  const colWidth = CONTENT_WIDTH / 2 - 12;
  let h1 = drawField(doc, PAGE_MARGIN, y, colWidth, 'Fabricante', batch.manufacturerName);
  let h2 = drawField(doc, PAGE_MARGIN + colWidth + 24, y, colWidth, 'Fecha de pago', dateFmt(batch.paymentDate));
  y += Math.max(h1, h2, 34);
  h1 = drawField(doc, PAGE_MARGIN, y, colWidth, 'Método de pago', methodLabel(batch.paymentMethod));
  h2 = drawField(doc, PAGE_MARGIN + colWidth + 24, y, colWidth, 'Referencia', batch.reference);
  y += Math.max(h1, h2, 34);
  if (batch.periodFrom || batch.periodTo) {
    y += drawField(doc, PAGE_MARGIN, y, CONTENT_WIDTH, 'Periodo cubierto',
      `${dateFmt(batch.periodFrom)} — ${dateFmt(batch.periodTo)}`);
  }
  if (batch.notes) {
    y += drawField(doc, PAGE_MARGIN, y, CONTENT_WIDTH, 'Notas', batch.notes);
  }

  y = drawDivider(doc, y + 4);
  y = drawSectionLabel(doc, y, 'Documentos cubiertos');
  const lines = batch.lines || [];
  if (!lines.length) {
    y = emptyRow(doc, y, 'Sin documentos.');
  } else {
    for (const line of lines) {
      const folio = line.folio || (line.sourceType === 'order' ? `Pedido #${line.sourceId}` : `OC #${line.sourceId}`);
      // Encabezado del documento SIN la línea de ledgerRow (que dibuja su
      // propia micro-regla): aquí la regla va una sola vez, al final del
      // grupo, después de sus piezas — no entre el folio y su detalle.
      doc.font('Helvetica-Bold').fontSize(10.5).fillColor(INK_SOFT)
        .text(folio, PAGE_MARGIN, y, { width: CONTENT_WIDTH - 140 });
      doc.font('Helvetica').fontSize(11).fillColor(INK_SOFT)
        .text(money(line.amount), PAGE_MARGIN, y, { width: CONTENT_WIDTH, align: 'right' });
      y += 18;

      const items = line.items || [];
      for (const item of items) {
        const thumb = await loadThumbnail(item.imageUrl);
        y = itemRow(doc, y, {
          thumb, quantity: item.quantity, productName: item.productName, color: item.color,
        });
      }

      y += 4;
      doc.strokeColor(CALLOUT_BORDER).lineWidth(0.5)
        .moveTo(PAGE_MARGIN, y).lineTo(CONTENT_RIGHT, y).stroke();
      y += 12;
    }
  }

  y = drawTotalBand(doc, y + 10, 'Total pagado', batch.totalAmount);
  y = drawFiscalBlock(doc, y);
  doc.y = y;
  drawFooter(doc, [
    `Generado el ${new Date().toLocaleString('es-MX')}${batch.createdByName ? ` por ${batch.createdByName}` : ''}`,
    'Comprobante interno de pago — no sustituye el CFDI que el fabricante debe emitir',
  ]);

  doc.end();
  return buffer;
}

/**
 * Estado de cuenta de un fabricante por un periodo — ver
 * ManufacturerPayable.createStatement para la forma de `statement`.
 */
function buildAccountStatementPdf(statement) {
  const doc = newDoc();
  const buffer = collectBuffer(doc);

  let y = drawHeader(doc, 'Estado de cuenta', statement.statementNumber);
  y = drawDivider(doc, y);

  const colWidth = CONTENT_WIDTH / 2 - 12;
  const h1 = drawField(doc, PAGE_MARGIN, y, colWidth, 'Fabricante', statement.manufacturerName);
  const h2 = drawField(doc, PAGE_MARGIN + colWidth + 24, y, colWidth, 'Periodo',
    `${dateFmt(statement.periodFrom)} — ${dateFmt(statement.periodTo)}`);
  y += Math.max(h1, h2, 34);

  y = drawTotalBand(doc, y, 'Saldo inicial (documentos previos al periodo)', statement.openingBalance, 36);

  y = drawSectionLabel(doc, y, 'Documentos devengados en el periodo');
  const docs = statement.documents || [];
  if (!docs.length) {
    y = emptyRow(doc, y, 'Ninguno.');
  } else {
    for (const d of docs) {
      y = ledgerRow(doc, y, { left: d.folio, sub: d.reference || undefined, right: money(d.amount) });
    }
  }

  y = drawDivider(doc, y + 4);
  y = drawSectionLabel(doc, y, 'Pagos aplicados en el periodo');
  const payments = statement.payments || [];
  if (!payments.length) {
    y = emptyRow(doc, y, 'Ninguno.');
  } else {
    for (const p of payments) {
      y = ledgerRow(doc, y, {
        left: `${methodLabel(p.paymentMethod)}${p.reference ? ` · ${p.reference}` : ''}`,
        sub: dateFmt(p.paymentDate),
        right: `– ${money(p.totalAmount)}`,
        rightColor: TAUPE_TEXT,
      });
    }
  }

  y = drawTotalBand(doc, y + 10, 'Saldo al cierre del periodo', statement.closingBalance);
  y = drawFiscalBlock(doc, y);
  doc.y = y;
  drawFooter(doc, [`Generado el ${new Date().toLocaleString('es-MX')}`]);

  doc.end();
  return buffer;
}

module.exports = { buildPaymentReceiptPdf, buildAccountStatementPdf };
