/**
 * Entrada de la bitácora de ediciones (`activity_log`). La comparten
 * cotizaciones y pedidos: quién tocó el documento, cuándo y qué cambió.
 */
export interface ActivityChangeField {
  label: string;
  before: string;
  after: string;
}

export interface ActivityItemChanges {
  added: string[];
  removed: string[];
  modified: string[];
}

export interface ActivityChanges {
  items?: ActivityItemChanges;
  /** Resto de campos escalares (cliente, teléfono, total, …). */
  [field: string]: ActivityChangeField | ActivityItemChanges | undefined;
}

export interface ActivityEntry {
  id: number;
  entityType: 'order' | 'quote';
  entityId: number;
  /** 'edit' | 'confirm' | 'extra_charge' | 'convert' | 'create' | 'cancel'. */
  action: string;
  actorId: number | null;
  actorName: string | null;
  actorRole: string | null;
  /** Frase legible del cambio, ya armada por el backend. */
  summary: string | null;
  /** Detalle campo→{before,after}; null en acciones sin diff (confirmar, convertir). */
  changes: ActivityChanges | null;
  createdAt: string;
}
