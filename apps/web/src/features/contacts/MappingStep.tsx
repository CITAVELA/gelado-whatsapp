import { IMPORT_FIELDS, IMPORT_FIELD_ES, type ImportField } from '@gelado/shared';

/** Paso 2 del asistente: a qué campo va cada columna del archivo. */
export function MappingStep({ columns, mapping, sampleRows, onChange }: {
  columns: string[];
  mapping: Record<string, ImportField>;
  sampleRows: Record<string, string>[];
  onChange: (column: string, field: ImportField) => void;
}) {
  const hasPhone = ['phone', 'email', 'customerCode'].some((f) => Object.values(mapping).includes(f as never));
  return (
    <div className="panel tbl-wrap">
      <table>
        <thead><tr><th>Columna del archivo</th><th>Se guarda en</th><th>Ejemplo</th></tr></thead>
        <tbody>
          {columns.map((col, i) => {
            const field = mapping[col] ?? 'ignore';
            const example = sampleRows.map((r) => r[col]).find((v) => v) ?? '';
            return (
              <tr key={col}>
                <td style={{ fontWeight: 600 }}>{col}</td>
                <td>
                  <select id={`map-${i}`} className="field" style={{ height: 32, color: field === 'ignore' ? '#8A919A' : undefined }} value={field}
                    aria-label={`Campo para la columna ${col}`} onChange={(e) => onChange(col, e.target.value as ImportField)}>
                    {IMPORT_FIELDS.map((f) => <option key={f} value={f}>{IMPORT_FIELD_ES[f]}</option>)}
                  </select>
                </td>
                <td className="hint">{example || '—'}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {!hasPhone && <div className="err" role="alert" style={{ padding: '10px 14px' }}>Elige qué columna contiene el teléfono móvil (o, al menos, el correo o el código): sin ninguno no se puede crear el contacto. Los contactos sin teléfono se importan como «Sin WhatsApp».</div>}
    </div>
  );
}
