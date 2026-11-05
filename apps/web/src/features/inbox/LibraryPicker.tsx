// Biblioteca de archivos (catálogos, cartas de color): carpetas, buscador, vista previa y selección (Bandeja-biblioteca.dc.html).
import { useMemo, useState } from 'react';
import type { LibraryFileDto, LibraryFolderDto } from '@gelado/shared';
import { Icon } from '../../components/Icon';
import { Lightbox } from '../../components/Lightbox';
import { SearchInput } from '../../components/SearchInput';
import { Spinner } from '../../components/ui';
import { fmtBytes } from '../../lib/format';
import { useLibraryFiles, useLibraryFolders } from './hooks';
import { fileExt } from './utils';

export function LibraryPicker({ selected, onToggle, accept }: { selected: Map<string, LibraryFileDto>; onToggle: (f: LibraryFileDto) => void; accept?: (f: LibraryFileDto) => boolean }) {
  const [folderId, setFolderId] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [preview, setPreview] = useState<LibraryFileDto | null>(null);
  const folders = useLibraryFolders();
  const files = useLibraryFiles(folderId, q);

  const all = folders.data ?? [];
  const trail = useMemo(() => {
    const t: LibraryFolderDto[] = [];
    let cur = all.find((f) => f.id === folderId);
    while (cur) {
      t.unshift(cur);
      cur = all.find((f) => f.id === cur!.parentId);
    }
    return t;
  }, [all, folderId]);
  const searching = !!q.trim();
  const subfolders = searching ? [] : all.filter((f) => f.parentId === folderId);
  const list = (files.data ?? []).filter((f) => (searching || f.folderId === folderId) && (!accept || accept(f)));

  return (
    <div className="lib-picker">
      <div className="toolbar"><SearchInput value={q} onChange={setQ} placeholder="Buscar en la biblioteca…" label="Buscar en la biblioteca" /></div>
      <div className="hint lib-trail">
        <button type="button" className="link-btn" onClick={() => setFolderId(null)}>Biblioteca</button>
        {trail.map((f) => (
          <span key={f.id}> › <button type="button" className="link-btn" onClick={() => setFolderId(f.id)}>{f.name}</button></span>
        ))}
        {searching && <span> › resultados de la búsqueda</span>}
      </div>
      <div className="panel lib-table">
        {(folders.isLoading || files.isLoading) && <div className="empty"><Spinner /></div>}
        <table>
          <tbody>
            {subfolders.map((f) => (
              <tr key={f.id} className="clickable" onClick={() => setFolderId(f.id)}>
                <td style={{ width: 30 }}><Icon name="folder" small /></td>
                <td><b>{f.name}</b></td>
                <td className="hint">{f.fileCount} archivos</td>
                <td />
              </tr>
            ))}
            {list.map((f) => {
              const on = selected.has(f.id);
              const isImg = f.media.mimeType.startsWith('image/');
              return (
                <tr key={f.id} className={`clickable${on ? ' sel' : ''}`} onClick={() => onToggle(f)} aria-selected={on}>
                  <td style={{ width: 30 }}><span className={`box${on ? ' on' : ''}`} role="checkbox" aria-checked={on} aria-label={`Seleccionar ${f.name}`} /></td>
                  <td>
                    <div className="row">
                      {isImg && f.media.url ? <img className="lib-thumb" src={f.media.url} alt="" /> : <div className="pdf sm">{fileExt(f.media.fileName, f.media.mimeType).slice(0, 4)}</div>}
                      <span className={on ? 'b' : ''}>{f.name}</span>
                    </div>
                  </td>
                  <td className="hint">{fmtBytes(f.media.sizeBytes)}</td>
                  <td style={{ width: 34 }}>
                    <button type="button" className="tbtn" aria-label={`Vista previa de ${f.name}`} title="Vista previa" onClick={(e) => { e.stopPropagation(); if (isImg) setPreview(f); else if (f.media.url) window.open(f.media.url, '_blank', 'noopener'); }}>
                      <Icon name="eye" small />
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {!files.isLoading && subfolders.length === 0 && list.length === 0 && <div className="empty">{searching ? 'No hay archivos con ese nombre.' : 'Esta carpeta está vacía.'}</div>}
      </div>
      {preview?.media.url && <Lightbox src={preview.media.url} alt={preview.name} downloadName={preview.media.fileName} onClose={() => setPreview(null)} />}
    </div>
  );
}
