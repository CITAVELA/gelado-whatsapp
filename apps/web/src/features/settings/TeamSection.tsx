import { useMutation, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { LABELS_ES, type TokenLinkDto, type UserDto } from '@gelado/shared';
import { api } from '../../lib/api';
import { queryClient } from '../../lib/query';
import { useAuth } from '../../lib/auth';
import { fmtDateTime } from '../../lib/format';
import { Avatar, ConfirmModal, Modal, Spinner, useToast } from '../../components/ui';
import { Icon } from '../../components/Icon';
import { CopyBox, SectionHead, errMsg } from './shared';

const KEY = ['users'] as const;
const refresh = () => queryClient.invalidateQueries({ queryKey: KEY });

function InviteModal({ onClose, onDone }: { onClose: () => void; onDone: (name: string, link: TokenLinkDto) => void }) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<'AGENT' | 'ADMIN'>('AGENT');
  const [error, setError] = useState<string | null>(null);
  const m = useMutation({
    mutationFn: () => api.post<{ user: UserDto; link: TokenLinkDto }>('/api/users', { name, email, role }),
    onSuccess: (r) => { void refresh(); onDone(r.user.name, r.link); },
    onError: (e) => setError(errMsg(e)),
  });
  return (
    <Modal title="Invitar a un miembro del equipo" onClose={onClose} width={480} footer={<>
      <button className="btn" onClick={onClose}>Cancelar</button>
      <button className="btn primary" disabled={m.isPending || !name.trim() || !email.trim()} onClick={() => m.mutate()}>Crear invitación</button>
    </>}>
      <form className="col" style={{ gap: 12 }} onSubmit={(e) => { e.preventDefault(); if (name.trim() && email.trim()) m.mutate(); }}>
        <label><span className="label">Nombre</span><input className="set-input" value={name} onChange={(e) => setName(e.target.value)} autoFocus /></label>
        <label><span className="label">Correo de acceso</span><input className="set-input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></label>
        <label><span className="label">Rol</span>
          <select className="set-input" value={role} onChange={(e) => setRole(e.target.value as 'AGENT' | 'ADMIN')}>
            <option value="AGENT">{LABELS_ES.role.AGENT}</option>
            <option value="ADMIN">{LABELS_ES.role.ADMIN}</option>
          </select>
        </label>
        <div className="hint">No se envía ningún correo: al crear la invitación verás un enlace para copiar y pasárselo a la persona.</div>
        {error && <div className="set-err" role="alert">{error}</div>}
      </form>
    </Modal>
  );
}

/** Ajustes → Equipo (RF-1.2/1.3): lista, invitar con enlace, rol, desactivar y enlaces de contraseña. */
export function TeamSection() {
  const { user: me } = useAuth();
  const toast = useToast();
  const users = useQuery({ queryKey: KEY, queryFn: () => api.get<UserDto[]>('/api/users') });
  const [invite, setInvite] = useState(false);
  const [link, setLink] = useState<{ label: string; url: string; expiresAt: string } | null>(null);
  const [confirm, setConfirm] = useState<UserDto | null>(null);

  const patch = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Partial<Pick<UserDto, 'role' | 'active' | 'name'>> }) => api.patch<UserDto>(`/api/users/${id}`, body),
    onSuccess: () => void refresh(),
    onError: (e) => toast(errMsg(e), true),
  });
  const makeLink = async (u: UserDto, kind: 'reset-link' | 'invite-link') => {
    try {
      const l = await api.post<TokenLinkDto>(`/api/users/${u.id}/${kind}`);
      setLink({ label: kind === 'reset-link' ? `Enlace de nueva contraseña para ${u.name}` : `Enlace de invitación para ${u.name}`, url: l.url, expiresAt: l.expiresAt });
      void refresh();
    } catch (e) {
      toast(errMsg(e), true);
    }
  };

  return (
    <div className="set-page page">
      <SectionHead
        title="Gestionar el equipo"
        sub="Sin correos: los enlaces de invitación y de nueva contraseña se copian y se pasan a cada persona."
        actions={<button className="btn primary" onClick={() => setInvite(true)}><Icon name="userPlus" small />Invitar a un miembro del equipo</button>}
      />
      <div className="panel tbl-wrap">
        {users.isLoading ? <div className="empty"><Spinner /></div> : (
          <table>
            <thead><tr><th>Nombre</th><th>Correo de acceso</th><th>Rol</th><th>Estado</th><th>Último acceso</th><th><span className="hint">Acciones</span></th></tr></thead>
            <tbody>
              {(users.data ?? []).map((u) => {
                const self = u.id === me?.id;
                return (
                  <tr key={u.id} style={u.active ? undefined : { opacity: 0.6 }}>
                    <td><div className="row" style={{ gap: 10 }}><Avatar name={u.name} /><b>{u.name}{self ? ' (tú)' : ''}</b></div></td>
                    <td className="hint">{u.email}</td>
                    <td>
                      {self ? <span className="pill p-blue">{LABELS_ES.role[u.role]}</span> : (
                        <select aria-label={`Rol de ${u.name}`} className="set-time" style={{ width: 150 }} value={u.role} disabled={!u.active || patch.isPending} onChange={(e) => patch.mutate({ id: u.id, body: { role: e.target.value as 'ADMIN' | 'AGENT' } })}>
                          <option value="AGENT">{LABELS_ES.role.AGENT}</option>
                          <option value="ADMIN">{LABELS_ES.role.ADMIN}</option>
                        </select>
                      )}
                    </td>
                    <td>{!u.active ? <span className="pill p-grey">Desactivada</span> : u.pendingInvite ? <span className="pill p-warn">Invitación pendiente</span> : <span className="pill p-ok">Activa</span>}</td>
                    <td className="hint">{u.lastLoginAt ? fmtDateTime(u.lastLoginAt) : '—'}</td>
                    <td className="set-actions">
                      {!self && (
                        <div className="set-actions-list">
                          {u.active && u.pendingInvite && <a href="#" onClick={(e) => { e.preventDefault(); void makeLink(u, 'invite-link'); }}>Regenerar enlace de invitación</a>}
                          {u.active && !u.pendingInvite && <a href="#" onClick={(e) => { e.preventDefault(); void makeLink(u, 'reset-link'); }}>Enlace de nueva contraseña</a>}
                          {u.active && <a href="#" style={{ color: '#B4232A' }} onClick={(e) => { e.preventDefault(); setConfirm(u); }}>Desactivar</a>}
                          {!u.active && <a href="#" onClick={(e) => { e.preventDefault(); patch.mutate({ id: u.id, body: { active: true } }); }}>Reactivar</a>}
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
      {link && (
        <>
          <CopyBox label={link.label} text={link.url} />
          <div className="hint" style={{ marginTop: -8 }}>Válido hasta {fmtDateTime(link.expiresAt)} y una sola vez. Al abrirlo, la persona crea su contraseña. Este enlace no se vuelve a mostrar.</div>
        </>
      )}
      <div className="panel" style={{ padding: '16px 18px', maxWidth: 720 }}>
        <div style={{ fontWeight: 700, marginBottom: 8 }}>Qué puede hacer cada rol</div>
        <div className="grid2" style={{ fontSize: 13 }}>
          <div><span className="pill p-blue">Administradora</span><div className="hint" style={{ marginTop: 6 }}>Todo: bandeja, contactos, exportar, plantillas, campañas, ajustes y equipo.</div></div>
          <div><span className="pill p-grey">Agente</span><div className="hint" style={{ marginTop: 6 }}>Bandeja y contactos. Puede preparar borradores de campaña, pero no lanzarlas ni crear plantillas.</div></div>
        </div>
      </div>
      {invite && <InviteModal onClose={() => setInvite(false)} onDone={(name, l) => { setInvite(false); setLink({ label: `Enlace de invitación para ${name}`, url: l.url, expiresAt: l.expiresAt }); }} />}
      {confirm && (
        <ConfirmModal
          title="Desactivar usuario"
          danger
          confirmText="Desactivar"
          text={<>{confirm.name} dejará de poder entrar y se cerrarán sus sesiones. Sus conversaciones y mensajes se conservan.</>}
          onConfirm={async () => { await patch.mutateAsync({ id: confirm.id, body: { active: false } }); }}
          onClose={() => setConfirm(null)}
        />
      )}
    </div>
  );
}
