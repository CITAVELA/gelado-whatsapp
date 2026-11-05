// Menús de acciones de una conversación: «…» (tarjeta y cabecera), Asignar, Etiquetar y Posponer (Bandeja-acciones.dc.html).
import { useState, type ReactNode } from 'react';
import type { ConversationListItemDto } from '@gelado/shared';
import { Popover, MenuItem, SubMenu } from '../../components/Popover';
import { Avatar, LabelChip, Modal } from '../../components/ui';
import { DateTimePicker } from '../../components/DateTimePicker';
import { useAuth } from '../../lib/auth';
import { useConversationActions, useLabels, useUsers } from './hooks';
import { madridToIso, madridYmd, snoozeOptions } from './utils';

type Conv = Pick<ConversationListItemDto, 'id' | 'status' | 'starred' | 'assignee' | 'conversationLabels' | 'unreadCount'>;
export type MenuMode = 'all' | 'assign' | 'labels' | 'snooze';

function AssignItems({ conv, close }: { conv: Conv; close: () => void }) {
  const { user } = useAuth();
  const users = useUsers();
  const act = useConversationActions();
  return (
    <>
      <div className="hint menu-title">Asignar a</div>
      <MenuItem checked={!conv.assignee} onClick={() => { void act.assign(conv.id, null); close(); }}>No asignado</MenuItem>
      {(users.data ?? []).filter((u) => u.active).map((u) => (
        <MenuItem key={u.id} checked={conv.assignee?.id === u.id} onClick={() => { void act.assign(conv.id, u); close(); }}>
          <span className="row"><Avatar small name={u.name} />{u.name}{u.id === user?.id ? ' (tú)' : ''}</span>
        </MenuItem>
      ))}
    </>
  );
}

function LabelItems({ conv }: { conv: Conv }) {
  const labels = useLabels();
  const act = useConversationActions();
  const all = (labels.data ?? []).filter((l) => l.scope === 'CONVERSATION');
  return (
    <>
      <div className="hint menu-title">Etiquetas de la conversación</div>
      {all.map((l) => {
        const on = conv.conversationLabels.some((c) => c.id === l.id);
        return (
          <MenuItem key={l.id} onClick={() => void act.setLabels(conv.id, conv.conversationLabels, all, on ? [] : [l.id], on ? [l.id] : [])}>
            <span className="row"><span className={`box${on ? ' on' : ''}`} aria-hidden="true" /><LabelChip label={l} /></span>
          </MenuItem>
        );
      })}
      {all.length === 0 && <div className="hint menu-title">No hay etiquetas de conversación.</div>}
      <div className="sep" />
      <div className="hint menu-title">Las etiquetas de tipo de cliente se ponen en la ficha</div>
    </>
  );
}

function SnoozeItems({ conv, close, onCustom }: { conv: Conv; close: () => void; onCustom: () => void }) {
  const act = useConversationActions();
  const opts = snoozeOptions();
  return (
    <>
      <div className="hint menu-title">Recordar más tarde en</div>
      {opts.map((o) => (
        <MenuItem key={o.preset} right={o.hint} onClick={() => { void act.snooze(conv.id, { preset: o.preset }); close(); }}>{o.label}</MenuItem>
      ))}
      <div className="sep" />
      <MenuItem icon="calendar" onClick={() => { close(); onCustom(); }}>Elegir fecha y hora</MenuItem>
    </>
  );
}

export function CustomSnoozeModal({ onClose, onConfirm }: { onClose: () => void; onConfirm: (iso: string) => void }) {
  const today = madridYmd();
  const [v, setV] = useState({ date: today, time: '08:00' });
  const valid = !!v.date && !!v.time && new Date(madridToIso(v.date, v.time)).getTime() > Date.now();
  return (
    <Modal title="Posponer hasta…" width={420} onClose={onClose} footer={<>
      <button className="btn" onClick={onClose}>Cancelar</button>
      <button className="btn primary" disabled={!valid} onClick={() => { onConfirm(madridToIso(v.date, v.time)); onClose(); }}>Posponer</button>
    </>}>
      <DateTimePicker date={v.date} time={v.time} min={today} onChange={setV} />
      {!valid && <div className="hint" style={{ marginTop: 10 }}>Elige una fecha y hora futuras.</div>}
    </Modal>
  );
}

/** Botón que abre el menú de acciones. `trigger` es el botón visible. */
export function ConversationMenuButton({ conv, mode = 'all', trigger, align = 'left', extra }: { conv: Conv; mode?: MenuMode; trigger: ReactNode; align?: 'left' | 'right'; extra?: (close: () => void) => ReactNode }) {
  const act = useConversationActions();
  const [custom, setCustom] = useState(false);
  const label = { all: 'Acciones de la conversación', assign: 'Asignar a', labels: 'Etiquetas', snooze: 'Posponer hasta' }[mode];
  return (
    <>
      <Popover trigger={trigger} align={align} label={label} minWidth={mode === 'all' ? 230 : 260}>
        {(close) => {
          if (mode === 'assign') return <AssignItems conv={conv} close={close} />;
          if (mode === 'labels') return <LabelItems conv={conv} />;
          if (mode === 'snooze') return <SnoozeItems conv={conv} close={close} onCustom={() => setCustom(true)} />;
          return (
            <>
              {conv.status === 'DONE' ? (
                <MenuItem icon="refresh" onClick={() => { void act.reopen(conv.id); close(); }}>Reabrir conversación</MenuItem>
              ) : (
                <MenuItem icon="check" onClick={() => { void act.done(conv.id); close(); }}>Marcar como finalizada</MenuItem>
              )}
              {conv.status === 'SNOOZED' && <MenuItem icon="refresh" onClick={() => { void act.reopen(conv.id); close(); }}>Reabrir ahora</MenuItem>}
              <MenuItem icon="star" onClick={() => { void act.star(conv.id, !conv.starred); close(); }}>{conv.starred ? 'Quitar marca' : 'Marcar'}</MenuItem>
              <SubMenu icon="clock" label="Posponer" minWidth={270}>{(c) => <SnoozeItems conv={conv} close={() => { c(); close(); }} onCustom={() => setCustom(true)} />}</SubMenu>
              <SubMenu icon="user" label="Asignar">{(c) => <AssignItems conv={conv} close={() => { c(); close(); }} />}</SubMenu>
              <SubMenu icon="tag" label="Etiqueta">{() => <LabelItems conv={conv} />}</SubMenu>
              <MenuItem icon="dot" onClick={() => { void act.markUnread(conv.id); close(); }}>Marcar como no leído</MenuItem>
              {extra?.(close)}
            </>
          );
        }}
      </Popover>
      {custom && (
        <div onClick={(e) => e.stopPropagation()}>
          <CustomSnoozeModal onClose={() => setCustom(false)} onConfirm={(until) => void act.snooze(conv.id, { preset: 'custom', until })} />
        </div>
      )}
    </>
  );
}
