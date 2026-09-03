import type Toolbar from 'quill/modules/toolbar';

/**
 * Configuración de los editores de texto enriquecido del admin (detalles de
 * producto, contenido fijo del sitio): la barra completa de ngx-quill
 * (`defaultModules.toolbar`, ver node_modules/ngx-quill/.../ngx-quill-config.mjs)
 * — negrita, cursiva, subrayado, tachado, cita, code-block, encabezados,
 * listas, sub/superíndice, sangría, dirección, tamaño, color, fondo, fuente,
 * alinear, borrar formato, link, imagen, video — MÁS los 6 botones de tabla
 * de acá abajo en vez del `['table']` genérico de ngx-quill (decisión
 * 2026-09-03: se había reducido por error a un set mínimo al arreglar el bug
 * de abajo; el usuario pidió recuperar todo lo de antes).
 *
 * Se pasa como `[modules]` DIRECTO en cada `<quill-editor>` — no por
 * `provideQuillConfig()` a nivel de ruta: probado (2026-09-03) que ese
 * override nunca llegaba a `QuillEditorComponent` (siempre mostraba el
 * toolbar "kitchen sink" completo de `defaultModules` en ngx-quill 28, en vez
 * del custom de la ruta). La causa exacta no se investigó a fondo
 * (probablemente algo en cómo se crea el modal del admin no hereda el
 * injector de la ruta); el input directo en el componente rodea el problema
 * sin depender de la causa.
 */
export const ADMIN_QUILL_MODULES = {
  table: true,
  toolbar: {
    container: [
      ['bold', 'italic', 'underline', 'strike'],
      ['blockquote', 'code-block'],
      [{ header: 1 }, { header: 2 }],
      [{ list: 'ordered' }, { list: 'bullet' }],
      [{ script: 'sub' }, { script: 'super' }],
      [{ indent: '-1' }, { indent: '+1' }],
      [{ direction: 'rtl' }],
      [{ size: ['small', false, 'large', 'huge'] }],
      [{ header: [1, 2, 3, 4, 5, 6, false] }],
      [{ color: [] }, { background: [] }],
      [{ font: [] }],
      [{ align: [] }],
      ['clean'],
      ['link', 'image', 'video'],
      ['table-insert', 'table-insert-row', 'table-insert-column', 'table-delete-row', 'table-delete-column', 'table-delete'],
    ],
    handlers: {} as Record<string, (this: Toolbar) => void>, // se llena abajo — TS no infiere bien un objeto recursivo inline
  },
};

/**
 * Métodos del módulo `table` de Quill (viene incluido en `quill` 2.x, ya
 * registrado por default — no es una dependencia nueva). No hay un `.d.ts`
 * público más específico que este; solo se usan los que llaman los botones
 * de abajo.
 */
interface QuillTableModule {
  insertTable(rows: number, columns: number): void;
  insertRowBelow(): void;
  insertColumnRight(): void;
  deleteRow(): void;
  deleteColumn(): void;
  deleteTable(): void;
}

/**
 * El módulo `table` de Quill no trae botón propio (solo la API: insertar,
 * borrar filas/columnas). Cada handler llama al método correspondiente sobre
 * la tabla donde está el cursor; sin selección dentro de una tabla, los de
 * fila/columna/borrar no hacen nada (la API ya lo resuelve así — ver
 * `getTable()` en quill/modules/table.js).
 */
Object.assign(ADMIN_QUILL_MODULES.toolbar.handlers, {
  'table-insert': function insertTable(this: Toolbar) {
    (this.quill.getModule('table') as QuillTableModule).insertTable(3, 3);
  },
  'table-insert-row': function insertRow(this: Toolbar) {
    (this.quill.getModule('table') as QuillTableModule).insertRowBelow();
  },
  'table-insert-column': function insertColumn(this: Toolbar) {
    (this.quill.getModule('table') as QuillTableModule).insertColumnRight();
  },
  'table-delete-row': function deleteRow(this: Toolbar) {
    (this.quill.getModule('table') as QuillTableModule).deleteRow();
  },
  'table-delete-column': function deleteColumn(this: Toolbar) {
    (this.quill.getModule('table') as QuillTableModule).deleteColumn();
  },
  'table-delete': function deleteTable(this: Toolbar) {
    (this.quill.getModule('table') as QuillTableModule).deleteTable();
  },
} satisfies Record<string, (this: Toolbar) => void>);

// Iconos de los botones de tabla: mismos SVG que trae Quill en
// assets/icons/table*.svg (no se importan como asset porque Quill no los
// registra solo — su toolbar solo conoce los formats nativos). "Borrar
// tabla" es el único que no tiene un icono de Quill; es uno propio, mismo
// estilo (18×18, clases ql-stroke/ql-fill) para que herede los colores
// hover/activo del tema.
const TABLE_ICONS: Record<string, string> = {
  'table-insert': `<svg viewbox="0 0 18 18">
    <rect class="ql-stroke" height="12" width="12" x="3" y="3"></rect>
    <rect class="ql-fill" height="2" width="3" x="5" y="5"></rect>
    <rect class="ql-fill" height="2" width="4" x="9" y="5"></rect>
    <g class="ql-fill ql-transparent">
      <rect height="2" width="3" x="5" y="8"></rect>
      <rect height="2" width="4" x="9" y="8"></rect>
      <rect height="2" width="3" x="5" y="11"></rect>
      <rect height="2" width="4" x="9" y="11"></rect>
    </g>
  </svg>`,
  'table-insert-row': `<svg viewbox="0 0 18 18">
    <g class="ql-fill ql-stroke ql-thin ql-transparent">
      <rect height="3" rx="0.5" ry="0.5" width="7" x="4.5" y="2.5"></rect>
      <rect height="3" rx="0.5" ry="0.5" width="7" x="4.5" y="12.5"></rect>
    </g>
    <rect class="ql-fill ql-stroke ql-thin" height="3" rx="0.5" ry="0.5" width="7" x="8.5" y="7.5"></rect>
    <polygon class="ql-fill ql-stroke ql-thin" points="4.5 11 2.5 9 4.5 7 4.5 11"></polygon>
    <line class="ql-stroke" x1="6" x2="4" y1="9" y2="9"></line>
  </svg>`,
  'table-insert-column': `<svg viewbox="0 0 18 18">
    <g class="ql-fill ql-transparent">
      <rect height="10" rx="1" ry="1" width="4" x="12" y="2"></rect>
      <rect height="10" rx="1" ry="1" width="4" x="2" y="2"></rect>
    </g>
    <path class="ql-fill" d="M11.354,4.146l-2-2a0.5,0.5,0,0,0-.707,0l-2,2A0.5,0.5,0,0,0,7,5H8V6a1,1,0,0,0,2,0V5h1A0.5,0.5,0,0,0,11.354,4.146Z"></path>
    <rect class="ql-fill" height="8" rx="1" ry="1" width="4" x="7" y="8"></rect>
  </svg>`,
  'table-delete-row': `<svg viewbox="0 0 18 18">
    <g class="ql-fill ql-stroke ql-thin ql-transparent">
      <rect height="3" rx="0.5" ry="0.5" width="7" x="4.5" y="2.5"></rect>
      <rect height="3" rx="0.5" ry="0.5" width="7" x="4.5" y="12.5"></rect>
    </g>
    <rect class="ql-fill ql-stroke ql-thin" height="3" rx="0.5" ry="0.5" width="7" x="8.5" y="7.5"></rect>
    <line class="ql-stroke ql-thin" x1="6.5" x2="3.5" y1="7.5" y2="10.5"></line>
    <line class="ql-stroke ql-thin" x1="3.5" x2="6.5" y1="7.5" y2="10.5"></line>
  </svg>`,
  'table-delete-column': `<svg viewbox="0 0 18 18">
    <g class="ql-fill ql-transparent">
      <rect height="10" rx="1" ry="1" width="4" x="2" y="6"></rect>
      <rect height="10" rx="1" ry="1" width="4" x="12" y="6"></rect>
    </g>
    <rect class="ql-fill" height="8" rx="1" ry="1" width="4" x="7" y="2"></rect>
    <path class="ql-fill" d="M9.707,13l1.146-1.146a0.5,0.5,0,0,0-.707-0.707L9,12.293,7.854,11.146a0.5,0.5,0,0,0-.707.707L8.293,13,7.146,14.146a0.5,0.5,0,1,0,.707.707L9,13.707l1.146,1.146a0.5,0.5,0,0,0,.707-0.707Z"></path>
  </svg>`,
  'table-delete': `<svg viewbox="0 0 18 18">
    <rect class="ql-stroke" height="10" width="10" x="4" y="6"></rect>
    <line class="ql-stroke" x1="2" x2="16" y1="4" y2="4"></line>
    <line class="ql-stroke" x1="7" x2="7" y1="1" y2="4"></line>
    <line class="ql-stroke" x1="11" x2="11" y1="1" y2="4"></line>
  </svg>`,
};

// Este archivo también se importa desde código que se evalúa en el servidor
// (SSR arma el árbol de rutas ahí, aunque el panel de admin nunca se
// prerrenderiza) y un `import` ESTÁTICO de `quill` truena ahí con "document
// is not defined" — el paquete toca `document` con solo importarlo, sin ni
// llamar nada. `ngx-quill` mismo resuelve esto con un `import()` dinámico
// (ver su editor.component); se sigue el mismo patrón aquí.
if (typeof document !== 'undefined') {
  import('quill').then(({ default: Quill }) => {
    Object.assign(Quill.import('ui/icons') as Record<string, string>, TABLE_ICONS);
  });
}
