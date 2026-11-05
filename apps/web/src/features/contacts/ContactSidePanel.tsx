// CONTRATO (dueño: S2 · Contactos). Panel lateral de ficha editable que usa la bandeja (RF-2.21).
// Las props son el contrato con la bandeja: no cambiar.
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Icon } from '../../components/Icon';
import { Spinner } from '../../components/ui';
import { Avatar } from '../../components/ui';
import { formatPhone } from '@gelado/shared';
import { CampaignsList } from './Campaigns';
import { ConsentBlock } from './ConsentBlock';
import { ContactFields } from './ContactFields';
import { useContact, useSaveContact } from './hooks';
import { LabelPicker } from './LabelPicker';
import { NoWhatsappPill } from './NoWhatsappPill';
import './contacts.css';

export interface ContactSidePanelProps {
  contactId: string;
  onClose?: () => void;
}

export function ContactSidePanel({ contactId, onClose }: ContactSidePanelProps) {
  const q = useContact(contactId);
  const save = useSaveContact(contactId);
  const [editing, setEditing] = useState(false);
  const c = q.data;
  return (
    <aside className="info" aria-label="Ficha del contacto">
      <div className="row">
        <h3 className="grow">Ficha</h3>
        {c && <Link className="tbtn" to={`/contactos/${c.id}`} aria-label="Abrir la ficha completa" title="Abrir la ficha completa"><Icon name="link" small /></Link>}
        {onClose && <button className="tbtn" onClick={onClose} aria-label="Cerrar ficha"><Icon name="close" small /></button>}
      </div>
      {q.isLoading && <div className="empty"><Spinner /></div>}
      {q.isError && <div className="err" role="alert">No se ha podido cargar la ficha.</div>}
      {c && (
        <>
          <div className="row" style={{ gap: 10 }}>
            <Avatar name={c.displayName} />
            <div style={{ minWidth: 0 }}>
              <div style={{ fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.displayName}</div>
              <div className="hint">{c.profileName ? `Perfil de WhatsApp: «${c.profileName}»` : c.phoneE164 ? formatPhone(c.phoneE164) : 'Sin WhatsApp'}</div>
            </div>
          </div>
          <LabelPicker value={c.labels} onChange={(labelIds) => save.mutate({ labelIds })} disabled={save.isPending} />
          {editing ? (
            <ContactFields contact={c} compact idPrefix="sp" saving={save.isPending} onSave={(ch) => save.mutate(ch, { onSuccess: () => setEditing(false) })} />
          ) : (
            <>
              <div className="kv">
                <span className="k">Nombre</span><span className="v">{c.firstName ?? '—'}</span>
                <span className="k">Apellidos</span><span className="v">{c.lastName ?? '—'}</span>
                <span className="k">Teléfono</span><span className="v mono">{c.phoneE164 ? formatPhone(c.phoneE164) : <NoWhatsappPill />}</span>
                <span className="k">Teléfono fijo</span><span className="v mono">{c.landline ?? '—'}</span>
                <span className="k">Correo</span><span className="v" title={c.email ?? undefined}>{c.email ?? '—'}</span>
                <span className="k">Código</span><span className="v mono">{c.customerCode ?? '—'}</span>
                <span className="k">CIF / DNI</span><span className="v mono">{c.taxId ?? '—'}</span>
                <span className="k">Empresa</span><span className="v" title={c.company ?? undefined}>{c.company ?? '—'}</span>
              </div>
              {c.notes && <div className="hint" style={{ whiteSpace: 'pre-line' }}>{c.notes}</div>}
              <button className="btn" style={{ height: 32 }} onClick={() => setEditing(true)}><Icon name="edit" small />Editar datos</button>
            </>
          )}
          <div>
            <h3 style={{ marginBottom: 8 }}>Publicidad</h3>
            <ConsentBlock contact={c} />
          </div>
          <div>
            <h3 style={{ marginBottom: 8 }}>Últimas campañas</h3>
            <CampaignsList contactId={c.id} limit={5} />
          </div>
        </>
      )}
    </aside>
  );
}
