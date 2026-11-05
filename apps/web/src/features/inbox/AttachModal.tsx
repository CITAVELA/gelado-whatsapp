// «Adjuntar archivos»: biblioteca o ordenador, varios a la vez, con pie opcional (RF-2.8, RF-2.11).
import { useEffect, useRef, useState } from 'react';
import { validateMediaForWhatsApp, type LibraryFileDto } from '@gelado/shared';
import { Icon } from '../../components/Icon';
import { Modal } from '../../components/ui';
import { fmtBytes } from '../../lib/format';
import { inboxApi } from './api';
import { errMsg } from './hooks';
import { LibraryPicker } from './LibraryPicker';
import { fileExt } from './utils';

interface Local { file: File; error?: string }

export function AttachModal({ initialFiles = [], onSend, onClose }: { initialFiles?: File[]; onSend: (mediaFileIds: string[], caption: string) => Promise<boolean>; onClose: () => void }) {
  const [lib, setLib] = useState<Map<string, LibraryFileDto>>(new Map());
  const [locals, setLocals] = useState<Local[]>([]);
  const [caption, setCaption] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [over, setOver] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const addFiles = (list: FileList | File[]) => {
    const add = [...list].map((file) => {
      const v = validateMediaForWhatsApp(file.type, file.size);
      return { file, error: v.ok ? undefined : v.reason } as Local;
    });
    setLocals((l) => [...l, ...add]);
  };
  useEffect(() => {
    if (initialFiles.length) addFiles(initialFiles);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggle = (f: LibraryFileDto) => setLib((m) => { const n = new Map(m); if (n.has(f.id)) n.delete(f.id); else n.set(f.id, f); return n; });
  const valid = locals.filter((l) => !l.error);
  const total = lib.size + valid.length;

  async function send() {
    setError(null);
    try {
      const ids = [...lib.values()].map((f) => f.media.id);
      let i = 0;
      for (const l of valid) {
        setBusy(`Subiendo ${++i} de ${valid.length}…`);
        ids.push((await inboxApi.uploadMedia(l.file, l.file.name)).id);
      }
      setBusy('Enviando…');
      if (await onSend(ids, caption.trim())) onClose();
    } catch (e) {
      setError(errMsg(e, 'No se han podido subir los archivos'));
    } finally {
      setBusy(null);
    }
  }

  return (
    <Modal
      title="Adjuntar archivos"
      subtitle="Elige de la biblioteca o sube desde tu ordenador. Puedes enviar varios a la vez."
      width={920}
      height={620}
      bare
      onClose={onClose}
      footer={<>
        {error && <span className="err grow">{error}</span>}
        <button className="btn" onClick={onClose} disabled={!!busy}>Cancelar</button>
        <button className="btn primary" disabled={total === 0 || !!busy} onClick={() => void send()}>
          {busy ?? (total === 1 ? 'Enviar 1 archivo' : `Enviar ${total} archivos`)}
        </button>
      </>}
    >
      <div className="attach-grid">
        <div className="attach-lib"><LibraryPicker selected={lib} onToggle={toggle} /></div>
        <div className="attach-side">
          <span className="label" style={{ margin: 0 }}>Desde tu ordenador</span>
          <div
            className={`dropzone${over ? ' over' : ''}`}
            onDragOver={(e) => { e.preventDefault(); setOver(true); }}
            onDragLeave={() => setOver(false)}
            onDrop={(e) => { e.preventDefault(); setOver(false); addFiles(e.dataTransfer.files); }}
          >
            <Icon name="upload" />
            <div>Arrastra aquí fotos, PDF, audios o vídeos, o{' '}
              <button type="button" className="link-btn" onClick={() => input.current?.click()}>elige archivos</button>
            </div>
            <input ref={input} type="file" multiple hidden aria-label="Elegir archivos del ordenador" onChange={(e) => { if (e.target.files) addFiles(e.target.files); e.target.value = ''; }} />
          </div>
          <span className="label" style={{ margin: '6px 0 0' }}>Seleccionados ({lib.size + locals.length})</span>
          <div className="attach-list">
            {[...lib.values()].map((f) => (
              <div className="att" key={f.id}>
                <div className="pdf">{fileExt(f.media.fileName, f.media.mimeType).slice(0, 4)}</div>
                <div className="grow" style={{ minWidth: 0 }}><div className="fn trunc">{f.media.fileName ?? f.name}</div><div className="fs">De la biblioteca · {fmtBytes(f.media.sizeBytes)}</div></div>
                <button type="button" className="tbtn" aria-label={`Quitar ${f.name}`} onClick={() => toggle(f)}><Icon name="close" small /></button>
              </div>
            ))}
            {locals.map((l, i) => (
              <div className={`att${l.error ? ' bad' : ''}`} key={i}>
                <div className="pdf">{fileExt(l.file.name, l.file.type).slice(0, 4)}</div>
                <div className="grow" style={{ minWidth: 0 }}>
                  <div className="fn trunc">{l.file.name}</div>
                  <div className={l.error ? 'fs err' : 'fs'}>{l.error ?? `Subido desde el ordenador · ${fmtBytes(l.file.size)}`}</div>
                </div>
                <button type="button" className="tbtn" aria-label={`Quitar ${l.file.name}`} onClick={() => setLocals((x) => x.filter((_, j) => j !== i))}><Icon name="close" small /></button>
              </div>
            ))}
          </div>
          <label>
            <span className="label">Texto que acompaña (opcional)</span>
            <textarea className="area" rows={3} maxLength={1024} value={caption} onChange={(e) => setCaption(e.target.value)} placeholder="Aquí tienes el catálogo y la factura" />
          </label>
        </div>
      </div>
    </Modal>
  );
}
