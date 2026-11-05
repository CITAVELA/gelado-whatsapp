import { useQuery } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import type { LibraryFileDto, LibraryFolderDto } from '@gelado/shared';
import { api, qs } from '../../lib/api';
import { queryClient } from '../../lib/query';
import { fmtBytes, fmtDate } from '../../lib/format';
import { ConfirmModal, Empty, Modal, Spinner, useToast } from '../../components/ui';
import { Icon } from '../../components/Icon';
import { SectionHead, errMsg } from './shared';

const refresh = () => queryClient.invalidateQueries({ queryKey: ['library'] });

function NameModal({ title, initial, onSave, onClose }: { title: string; initial: string; onSave: (name: string) => Promise<void>; onClose: () => void }) {
  const [name, setName] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const go = async () => {
    setBusy(true);
    try { await onSave(name.trim()); onClose(); } catch (e) { setError(errMsg(e)); } finally { setBusy(false); }
  };
  return (
    <Modal title={title} onClose={onClose} width={420} footer={<><button className="btn" onClick={onClose}>Cancelar</button><button className="btn primary" disabled={!name.trim() || busy} onClick={go}>Guardar</button></>}>
      <form onSubmit={(e) => { e.preventDefault(); if (name.trim()) void go(); }}>
        <input className="set-input" aria-label="Nombre" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        {error && <div className="set-err" role="alert">{error}</div>}
      </form>
    </Modal>
  );
}

/** Ajustes → Biblioteca: carpetas y archivos que se pueden enviar desde la bandeja (solo administradoras gestionan). */
export function LibrarySection() {
  const toast = useToast();
  const fileInput = useRef<HTMLInputElement>(null);
  const [folderId, setFolderId] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [dialog, setDialog] = useState<
    | { kind: 'newFolder' } | { kind: 'renameFolder'; f: LibraryFolderDto } | { kind: 'deleteFolder'; f: LibraryFolderDto }
    | { kind: 'renameFile'; f: LibraryFileDto } | { kind: 'moveFile'; f: LibraryFileDto } | { kind: 'deleteFile'; f: LibraryFileDto } | null
  >(null);
  const folders = useQuery({ queryKey: ['library', 'folders'], queryFn: () => api.get<LibraryFolderDto[]>('/api/library/folders') });
  const files = useQuery({ queryKey: ['library', 'files', folderId, q], queryFn: () => api.get<LibraryFileDto[]>(`/api/library/files${qs({ folderId, q })}`) });
  const fail = (e: unknown) => toast(errMsg(e), true);

  const upload = async (list: FileList | null) => {
    if (!list?.length) return;
    try {
      for (const file of Array.from(list)) {
        const form = new FormData();
        form.append('file', file);
        if (folderId) form.append('folderId', folderId);
        await api.upload('/api/library/files', form);
      }
      toast(list.length === 1 ? 'Archivo subido' : `${list.length} archivos subidos`);
      void refresh();
    } catch (e) {
      fail(e);
    } finally {
      if (fileInput.current) fileInput.current.value = '';
    }
  };

  if (folders.isError) return <div className="set-page page"><SectionHead title="Biblioteca" /><div className="panel"><Empty>La biblioteca no está disponible ahora mismo.</Empty></div></div>;
  const list = folders.data ?? [];
  const selected = list.find((f) => f.id === folderId) ?? null;

  return (
    <div className="set-page page">
      <SectionHead
        title="Biblioteca"
        sub="Catálogos, tarifas y otros archivos para enviar a los clientes desde la bandeja."
        actions={<>
          <button className="btn" onClick={() => setDialog({ kind: 'newFolder' })}><Icon name="folder" small />Nueva carpeta</button>
          <button className="btn primary" onClick={() => fileInput.current?.click()}><Icon name="upload" small />Subir archivos</button>
          <input ref={fileInput} type="file" multiple hidden aria-label="Archivos a subir" onChange={(e) => void upload(e.target.files)} />
        </>}
      />
      <div className="set-lib">
        <div className="panel" style={{ padding: 8, alignSelf: 'start' }}>
          <button className={`set-folder${folderId === null ? ' on' : ''}`} onClick={() => setFolderId(null)}><Icon name="folder" small />Todos los archivos</button>
          {list.map((f) => (
            <button key={f.id} className={`set-folder${folderId === f.id ? ' on' : ''}`} onClick={() => setFolderId(f.id)}>
              <Icon name="folder" small /><span className="grow">{f.name}</span><span className="count">{f.fileCount}</span>
            </button>
          ))}
          {selected && (
            <div className="row" style={{ padding: '8px 10px' }}>
              <a href="#" onClick={(e) => { e.preventDefault(); setDialog({ kind: 'renameFolder', f: selected }); }}>Renombrar</a>·
              <a href="#" style={{ color: '#B4232A' }} onClick={(e) => { e.preventDefault(); setDialog({ kind: 'deleteFolder', f: selected }); }}>Borrar</a>
            </div>
          )}
        </div>
        <div className="col">
          <div className="search"><Icon name="search" small /><input aria-label="Buscar archivos" placeholder="Buscar por nombre" value={q} onChange={(e) => setQ(e.target.value)} style={{ border: 0, outline: 'none', flex: 1, background: 'transparent' }} /></div>
          <div className="panel tbl-wrap">
            {files.isLoading ? <div className="empty"><Spinner /></div> : !files.data?.length ? <Empty>{q ? 'Ningún archivo coincide.' : 'Aún no hay archivos aquí. Sube el primero.'}</Empty> : (
              <table>
                <thead><tr><th>Archivo</th><th>Carpeta</th><th>Tamaño</th><th>Subido</th><th><span className="hint">Acciones</span></th></tr></thead>
                <tbody>
                  {files.data.map((f) => (
                    <tr key={f.id}>
                      <td><span className="row"><Icon name={f.media.mimeType.startsWith('image/') ? 'image' : 'file'} small />{f.media.url ? <a href={f.media.url} target="_blank" rel="noreferrer">{f.name}</a> : f.name}</span></td>
                      <td className="hint">{list.find((x) => x.id === f.folderId)?.name ?? '—'}</td>
                      <td className="mono">{fmtBytes(f.media.sizeBytes)}</td>
                      <td className="hint">{fmtDate(f.createdAt)}</td>
                      <td>
                        <a href="#" onClick={(e) => { e.preventDefault(); setDialog({ kind: 'renameFile', f }); }}>Renombrar</a> ·{' '}
                        <a href="#" onClick={(e) => { e.preventDefault(); setDialog({ kind: 'moveFile', f }); }}>Mover</a> ·{' '}
                        <a href="#" style={{ color: '#B4232A' }} onClick={(e) => { e.preventDefault(); setDialog({ kind: 'deleteFile', f }); }}>Borrar</a>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>

      {dialog?.kind === 'newFolder' && <NameModal title="Nueva carpeta" initial="" onClose={() => setDialog(null)} onSave={async (name) => { await api.post('/api/library/folders', { name }); void refresh(); }} />}
      {dialog?.kind === 'renameFolder' && <NameModal title="Renombrar carpeta" initial={dialog.f.name} onClose={() => setDialog(null)} onSave={async (name) => { await api.patch(`/api/library/folders/${dialog.f.id}`, { name }); void refresh(); }} />}
      {dialog?.kind === 'renameFile' && <NameModal title="Renombrar archivo" initial={dialog.f.name} onClose={() => setDialog(null)} onSave={async (name) => { await api.patch(`/api/library/files/${dialog.f.id}`, { name }); void refresh(); }} />}
      {dialog?.kind === 'moveFile' && (
        <Modal title="Mover archivo" onClose={() => setDialog(null)} width={420}>
          <div className="col">
            <button className="set-folder" onClick={async () => { try { await api.patch(`/api/library/files/${dialog.f.id}`, { folderId: null }); void refresh(); setDialog(null); } catch (e) { fail(e); } }}><Icon name="folder" small />Sin carpeta</button>
            {list.map((f) => <button key={f.id} className={`set-folder${dialog.f.folderId === f.id ? ' on' : ''}`} onClick={async () => { try { await api.patch(`/api/library/files/${dialog.f.id}`, { folderId: f.id }); void refresh(); setDialog(null); } catch (e) { fail(e); } }}><Icon name="folder" small />{f.name}</button>)}
          </div>
        </Modal>
      )}
      {dialog?.kind === 'deleteFolder' && (
        <ConfirmModal title="Borrar carpeta" danger confirmText="Borrar" text={<>Se borrará la carpeta «{dialog.f.name}». Solo se puede borrar si está vacía.</>} onClose={() => setDialog(null)}
          onConfirm={async () => { try { await api.del(`/api/library/folders/${dialog.f.id}`); setFolderId(null); void refresh(); } catch (e) { fail(e); throw e; } }} />
      )}
      {dialog?.kind === 'deleteFile' && (
        <ConfirmModal title="Borrar archivo" danger confirmText="Borrar" text={<>Se borrará «{dialog.f.name}» de la biblioteca. Los mensajes ya enviados no se tocan.</>} onClose={() => setDialog(null)}
          onConfirm={async () => { try { await api.del(`/api/library/files/${dialog.f.id}`); void refresh(); } catch (e) { fail(e); throw e; } }} />
      )}
    </div>
  );
}
