import { useEffect, useState } from 'react';
import type { ContactDto, ContactUpsertDto } from '@gelado/shared';

type Form = { firstName: string; lastName: string; phone: string; landline: string; email: string; customerCode: string; taxId: string; company: string; notes: string };

export const toForm = (c?: ContactDto | null): Form => ({
  firstName: c?.firstName ?? '', lastName: c?.lastName ?? '', phone: c?.phoneE164 ?? '', landline: c?.landline ?? '', email: c?.email ?? '',
  customerCode: c?.customerCode ?? '', taxId: c?.taxId ?? '', company: c?.company ?? '', notes: c?.notes ?? '',
});

/** Solo los campos que han cambiado (PATCH parcial). */
export function diffForm(form: Form, c: ContactDto): Partial<ContactUpsertDto> {
  const base = toForm(c);
  const out: Record<string, string> = {};
  (Object.keys(form) as Array<keyof Form>).forEach((k) => {
    if (form[k].trim() !== base[k]) out[k] = form[k].trim();
  });
  return out as Partial<ContactUpsertDto>;
}

const FIELDS: Array<{ key: keyof Form; label: string; type?: string; mono?: boolean; full?: boolean; area?: boolean }> = [
  { key: 'firstName', label: 'Nombre' },
  { key: 'lastName', label: 'Apellidos' },
  { key: 'phone', label: 'Teléfono móvil (WhatsApp)', mono: true },
  { key: 'landline', label: 'Teléfono fijo', mono: true },
  { key: 'email', label: 'Correo', type: 'email' },
  { key: 'company', label: 'Empresa' },
  { key: 'customerCode', label: 'Código de cliente', mono: true },
  { key: 'taxId', label: 'CIF / DNI', mono: true },
  { key: 'notes', label: 'Notas', full: true, area: true },
];

/** Campos editables de la ficha. En la ficha completa (2 columnas) y en el panel lateral (1 columna, `compact`). */
export function ContactFields({ contact, onSave, saving, compact, idPrefix = 'cf' }: {
  contact: ContactDto;
  onSave: (changes: Partial<ContactUpsertDto>) => void;
  saving?: boolean;
  compact?: boolean;
  idPrefix?: string;
}) {
  const [form, setForm] = useState<Form>(toForm(contact));
  useEffect(() => setForm(toForm(contact)), [contact.id, contact.updatedAt]); // eslint-disable-line react-hooks/exhaustive-deps
  const changes = diffForm(form, contact);
  const dirty = Object.keys(changes).length > 0;
  return (
    <form className="ct-edit" onSubmit={(e) => { e.preventDefault(); if (dirty) onSave(changes); }}>
      <div className={compact ? 'col' : 'ct-fgrid'} style={compact ? { gap: 10 } : undefined}>
        {FIELDS.map((f) => (
          <div key={f.key} className={f.full ? 'full' : undefined}>
            <label htmlFor={`${idPrefix}-${f.key}`}>{f.label}</label>
            {f.area ? (
              <textarea id={`${idPrefix}-${f.key}`} className="area" value={form[f.key]} maxLength={5000} onChange={(e) => setForm({ ...form, [f.key]: e.target.value })} />
            ) : (
              <input id={`${idPrefix}-${f.key}`} className={`field${f.mono ? ' mono' : ''}`} type={f.type ?? 'text'} value={form[f.key]} onChange={(e) => setForm({ ...form, [f.key]: e.target.value })} />
            )}
          </div>
        ))}
      </div>
      {contact.profileName && <div className="hint" style={{ marginTop: 8 }}>Perfil de WhatsApp: «{contact.profileName}»</div>}
      <div className="row" style={{ marginTop: 12, justifyContent: 'flex-end' }}>
        {dirty && <button type="button" className="btn ghost" onClick={() => setForm(toForm(contact))}>Descartar</button>}
        <button type="submit" className="btn primary" disabled={!dirty || saving}>Guardar cambios</button>
      </div>
    </form>
  );
}
