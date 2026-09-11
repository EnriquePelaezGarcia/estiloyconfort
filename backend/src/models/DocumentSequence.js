const { pool } = require('../config/database');

/**
 * Folios genéricos por tipo de documento y año (REC-2026-0001, EDC-2026-0001,
 * ...). Mismo patrón atómico que Order.generateOrderNumber (Order.js): el
 * `INSERT ... ON DUPLICATE KEY UPDATE` toma el lock de la fila del año, así
 * que dos folios no chocan aunque se pidan casi al mismo tiempo.
 *
 * Tabla genérica (document_sequences: doc_type + seq_year) en vez de una
 * tabla de contador por cada tipo de documento nuevo — ver
 * schema_manufacturer_payment_documents.sql.
 */
async function generateDocumentNumber(docType, prefix, conn = pool) {
  const year = new Date().getFullYear();
  await conn.execute(
    'INSERT INTO document_sequences (doc_type, seq_year, last_seq) VALUES (?, ?, 1) '
    + 'ON DUPLICATE KEY UPDATE last_seq = last_seq + 1',
    [docType, year],
  );
  const [[{ last_seq: lastSeq }]] = await conn.execute(
    'SELECT last_seq FROM document_sequences WHERE doc_type = ? AND seq_year = ?',
    [docType, year],
  );
  return `${prefix}-${year}-${String(lastSeq).padStart(4, '0')}`;
}

module.exports = { generateDocumentNumber };
