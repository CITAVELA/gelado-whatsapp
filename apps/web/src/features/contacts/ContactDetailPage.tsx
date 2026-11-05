import { useState } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import { formatPhone } from '@gelado/shared';
import { Icon } from '../../components/Icon';
import { Avatar, ConfirmModal, Spinner, useToast } from '../../components/ui';
import { useAuth } from '../../lib/auth';
import { api, HttpError } from '../../lib/api';
import { fmtDateTime } from '../../lib/format';
import { CampaignsList } from './Campaigns';
import { ConsentBlock } from './ConsentBlock';
import { ContactFields } from './ContactFields';
import { errMsg, useContact, useOpenConversation, useRefreshContact, useSaveContact } from './hooks';
import { LabelPicker } from './LabelPicker';
import { NoWhatsappPill } from './NoWhatsappPill';

/** Ficha completa /contactos/:id */
export function ContactDetailPage() {
  const { id = '' } = useParams();
  const q = useContact(id);
  const save = useSaveContact(id);
  const open = useOpenConversation();
  const { isAdmin } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const refresh = useRefreshContact();
  const [del, setDel] = useState<null | 'soft' | 'hard'>(null);
  const c = q.data;

  if (q.isLoading) return <div className="page"><div className="empty"><Spinner /></div></div>;
  if (q.isError || !c) {
    const nf = q.error instanceof HttpError && q.error.status === 404;
    return <div className="page"><div className="panel empty">{nf ? 'Este contacto no existe o se ha borrado.' : 'No se ha podido cargar el contacto.'}<div style={{ marginTop: 12 }}><Link className="btn" to="/contactos">Volver a contactos</Link></div></div></div>;
  }
  return (
    <div className="page ct-detail">
      <div className="page-head">
        <Link className="btn ghost" to="/contactos" style={{ padding: '0 6px' }} aria-label="Volver a contactos"><Icon name="back" small /></Link>
        <Avatar name={c.displayName} />
        <div>
          <h1>{c.displayName}</h1>
          <div className="sub mono">{c.phoneE164 ? formatPhone(c.phoneE164) : <NoWhatsappPill />} · alta {fmtDateTime(c.createdAt)}</div>
        </div>
        <div className="row" style={{ marginLeft: 'auto' }}>
          <button className="btn primary" onClick={() => open(c)} disabled={!c.phoneE164} title={c.phoneE164 ? undefined : 'Sin WhatsApp: este contacto no tiene teléfono'}><Icon name="chat" small />Abrir conversación</button>
          {isAdmin && <button className="btn danger" onClick={() => setDel('soft')}><Icon name="trash" small />Borrar</button>}
        </div>
      </div>
      <div className="ct-detail-grid">
        <div className="panel">
          <div className="section">
            <h2>Datos</h2>
            <ContactFields contact={c} saving={save.isPending} onSave={(ch) => save.mutate(ch)} />
          </div>
          <div className="section">
            <h2>Etiquetas</h2>
            <LabelPicker value={c.labels} onChange={(labelIds) => save.mutate({ labelIds })} disabled={save.isPending} />
          </div>
        </div>
        <div className="col" style={{ gap: 18 }}>
          <div className="panel section"><h2>Publicidad</h2><ConsentBlock contact={c} /></div>
          <div className="panel section"><h2>Campañas recibidas</h2><CampaignsList contactId={c.id} /></div>
          {isAdmin && (
            <div className="panel section">
              <h2>Derecho de supresión</h2>
              <div className="hint" style={{ marginBottom: 8 }}>Borra para siempre al contacto, su conversación y sus mensajes. Queda constancia en el registro de auditoría.</div>
              <button className="btn danger" onClick={() => setDel('hard')}>Eliminar definitivamente…</button>
            </div>
          )}
        </div>
      </div>
      {del && (
        <ConfirmModal
          title={del === 'hard' ? 'Eliminar definitivamente' : 'Borrar contacto'} danger confirmText={del === 'hard' ? 'Eliminar para siempre' : 'Borrar'}
          text={del === 'hard'
            ? <>Se eliminarán <b>{c.displayName}</b>, su conversación y todos sus mensajes. <b>No se puede deshacer.</b></>
            : <>{c.displayName} dejará de aparecer en contactos y búsquedas. Se podrá volver a crear con el mismo teléfono.</>}
          onConfirm={async () => {
            try {
              await api.del(`/api/contacts/${c.id}${del === 'hard' ? '?hard=true' : ''}`);
              refresh();
              toast(del === 'hard' ? 'Contacto eliminado definitivamente' : 'Contacto borrado');
              navigate('/contactos');
            } catch (e) {
              toast(errMsg(e), true);
            }
          }}
          onClose={() => setDel(null)}
        />
      )}
    </div>
  );
}
