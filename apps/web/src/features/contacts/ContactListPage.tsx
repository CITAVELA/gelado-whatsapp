import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { formatPhone, type ConsentChangeDto, type ConsentStatus, type ContactDto, type LabelDto, type Paginated } from '@gelado/shared';
import { Icon } from '../../components/Icon';
import { ConsentPill, LabelChip, Modal, Spinner, useDropdown, useToast } from '../../components/ui';
import { useAuth } from '../../lib/auth';
import { api, qs } from '../../lib/api';
import { fmtListTime, fmtNumber } from '../../lib/format';
import { ConsentChangeModal } from './ConsentBlock';
import { errMsg, useLabels, useRefreshContact } from './hooks';

// ── Columnas ──
const COLUMNS = [
  { key: 'phone', label: 'Teléfono', def: true },
  { key: 'code', label: 'Código', def: true },
  { key: 'taxId', label: 'CIF / DNI', def: true },
  { key: 'landline', label: 'Teléfono fijo', def: true },
  { key: 'labels', label: 'Etiquetas', def: true },
  { key: 'consent', label: 'Publicidad', def: true },
  { key: 'activity', label: 'Última actividad', def: true },
  { key: 'email', label: 'Correo', def: false },
  { key: 'company', label: 'Empresa', def: false },
] as const;
type ColKey = (typeof COLUMNS)[number]['key'];
const COLS_KEY = 'gelado.contacts.columns';

function loadCols(): Set<ColKey> {
  try {
    const raw = localStorage.getItem(COLS_KEY);
    if (raw) return new Set(JSON.parse(raw) as ColKey[]);
  } catch { /* sin almacenamiento */ }
  return new Set(COLUMNS.filter((c) => c.def).map((c) => c.key));
}

// ── Filtros en la URL ──
export interface Filters { q: string; include: string[]; exclude: string[]; consent: ConsentStatus | ''; invalid: boolean; sort: 'name' | 'createdAt' | 'lastActivity'; page: number }

export function readFilters(sp: URLSearchParams): Filters {
  const consent = sp.get('consent');
  const sort = sp.get('sort');
  return {
    q: sp.get('q') ?? '',
    include: sp.getAll('include'),
    exclude: sp.getAll('exclude'),
    consent: consent === 'UNKNOWN' || consent === 'GRANTED' || consent === 'REVOKED' ? consent : '',
    invalid: sp.get('invalid') === '1',
    sort: sort === 'createdAt' || sort === 'lastActivity' ? sort : 'name',
    page: Math.max(1, Number(sp.get('page')) || 1),
  };
}
export function filtersToApi(f: Filters, extra: Record<string, unknown> = {}) {
  return { q: f.q, includeLabelIds: f.include, excludeLabelIds: f.exclude, consent: f.consent, phoneInvalid: f.invalid ? 'true' : '', sort: f.sort, ...extra };
}
const activeCount = (f: Filters) => f.include.length + f.exclude.length + (f.consent ? 1 : 0) + (f.invalid ? 1 : 0);

export function ContactListPage() {
  const [sp, setSp] = useSearchParams();
  const f = useMemo(() => readFilters(sp), [sp]);
  const { isAdmin } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const refresh = useRefreshContact();
  const labels = useLabels('CONTACT');
  const [cols, setCols] = useState<Set<ColKey>>(loadCols);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState(f.q);
  const [modal, setModal] = useState<null | 'new' | 'consent' | 'revoke'>(null);
  const filterDd = useDropdown();
  const colDd = useDropdown();
  const addDd = useDropdown();
  const remDd = useDropdown();

  useEffect(() => setSearch(f.q), [f.q]);
  useEffect(() => {
    const t = setTimeout(() => search !== f.q && update({ q: search }), 300);
    return () => clearTimeout(t);
  }, [search]); // eslint-disable-line react-hooks/exhaustive-deps

  function update(patch: Partial<Record<keyof Filters, unknown>>) {
    const next = { ...f, page: 1, ...patch } as Filters;
    const p = new URLSearchParams();
    if (next.q) p.set('q', next.q);
    next.include.forEach((x) => p.append('include', x));
    next.exclude.forEach((x) => p.append('exclude', x));
    if (next.consent) p.set('consent', next.consent);
    if (next.invalid) p.set('invalid', '1');
    if (next.sort !== 'name') p.set('sort', next.sort);
    if (next.page > 1) p.set('page', String(next.page));
    setSp(p, { replace: true });
  }

  const list = useQuery({
    queryKey: ['contacts', 'list', f],
    queryFn: () => api.get<Paginated<ContactDto>>(`/api/contacts${qs(filtersToApi(f, { page: f.page, pageSize: 100 }))}`),
    placeholderData: keepPreviousData,
  });
  const all = useQuery({ queryKey: ['contacts', 'list', 'total'], queryFn: () => api.get<Paginated<ContactDto>>('/api/contacts?pageSize=1'), staleTime: 60_000 });
  const items = list.data?.items ?? [];
  const total = list.data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / 100));

  const pageSelected = items.length > 0 && items.every((c) => selected.has(c.id));
  const togglePage = () => setSelected((s) => {
    const n = new Set(s);
    if (pageSelected) items.forEach((c) => n.delete(c.id)); else items.forEach((c) => n.add(c.id));
    return n;
  });
  const toggle = (id: string) => setSelected((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });

  async function selectAllMatching() {
    const ids: string[] = [];
    for (let p = 1; p <= Math.ceil(total / 500); p++) {
      const r = await api.get<Paginated<ContactDto>>(`/api/contacts${qs(filtersToApi(f, { page: p, pageSize: 500 }))}`);
      r.items.forEach((c) => ids.push(c.id));
    }
    setSelected(new Set(ids));
  }

  async function bulk(body: Record<string, unknown>, ok: string) {
    try {
      const r = await api.post<{ affected: number }>('/api/contacts/bulk', { contactIds: [...selected], ...body });
      toast(`${ok}: ${fmtNumber(r.affected)} contacto${r.affected === 1 ? '' : 's'}`);
      refresh();
      qc.invalidateQueries({ queryKey: ['contacts'] });
    } catch (e) {
      toast(errMsg(e), true);
    }
  }

  function exportCsv(ids?: string[]) {
    const url = `/api/contacts/export${qs(ids ? { ids } : filtersToApi(f))}`;
    window.location.assign(url);
  }

  const toggleCol = (k: ColKey) => {
    const n = new Set(cols);
    n.has(k) ? n.delete(k) : n.add(k);
    setCols(n);
    try { localStorage.setItem(COLS_KEY, JSON.stringify([...n])); } catch { /* sin almacenamiento */ }
  };
  const toggleArr = (arr: string[], id: string) => (arr.includes(id) ? arr.filter((x) => x !== id) : [...arr, id]);
  const nFilters = activeCount(f);
  const baseTotal = all.data?.total;
  const selCount = selected.size;
  const isView = (pred: (f: Filters) => boolean) => pred(f) && !f.q && activeCount(f) === (pred(f) ? 1 : 0);
  const labelList = labels.data ?? [];

  return (
    <>
      <aside className="views" aria-label="Vistas de contactos">
        <h2>Vistas</h2>
        <Link className={`view${!nFilters && !f.q ? ' on' : ''}`} to="/contactos">Todos los contactos{baseTotal != null && <span className="n">{fmtNumber(baseTotal)}</span>}</Link>
        <Link className={`view${isView((x) => x.consent === 'REVOKED') ? ' on' : ''}`} to="/contactos?consent=REVOKED">Dados de baja de publicidad</Link>
        <Link className={`view${isView((x) => x.invalid) ? ' on' : ''}`} to="/contactos?invalid=1">Teléfono no válido</Link>
        <div className="sect">Tipo de cliente</div>
        {labelList.map((l) => (
          <Link key={l.id} className={`view${isView((x) => x.include.length === 1 && x.include[0] === l.id) ? ' on' : ''}`} to={`/contactos?include=${l.id}`}>
            <span className="sw" style={{ background: l.color }} />{l.name.charAt(0) + l.name.slice(1).toLowerCase()}
          </Link>
        ))}
      </aside>

      <main className="main">
        <div className="page">
          <div className="page-head">
            <h1>Contactos ({baseTotal != null ? fmtNumber(baseTotal) : '…'})</h1>
            {nFilters > 0 || f.q ? <span className="count" aria-live="polite">{fmtNumber(total)} coinciden</span> : null}
            <div className="row" style={{ marginLeft: 'auto' }}>
              {isAdmin && <button className="btn" onClick={() => exportCsv()}><Icon name="download" small />{nFilters || f.q ? 'Exportar filtrados' : 'Exportar todo'}</button>}
              <Link className="btn" to="/contactos/importar"><Icon name="upload" small />Importar</Link>
              <button className="btn primary" onClick={() => setModal('new')}><Icon name="plus" small />Nuevo contacto</button>
            </div>
          </div>

          <div className="toolbar">
            <label className="search ct-search">
              <Icon name="search" small />
              <input type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar por nombre, teléfono, código o CIF…" aria-label="Buscar contactos" />
            </label>
            <div className="ct-rel" ref={filterDd.ref}>
              <button className="btn" onClick={() => filterDd.setOpen(!filterDd.open)} aria-expanded={filterDd.open}><Icon name="filter" small />{nFilters ? `Filtros (${nFilters})` : 'Añadir filtro'}</button>
              {filterDd.open && (
                <div className="ct-pop" style={{ top: '100%', left: 0, marginTop: 4, width: 300 }} role="dialog" aria-label="Filtros">
                  <h4>Con alguna de estas etiquetas</h4>
                  {labelList.map((l) => (
                    <label key={l.id} className="opt"><input type="checkbox" className="ct-check" checked={f.include.includes(l.id)} onChange={() => update({ include: toggleArr(f.include, l.id), exclude: f.exclude.filter((x) => x !== l.id) })} /><span className="sw" style={{ background: l.color }} />{l.name}</label>
                  ))}
                  <h4>Sin ninguna de estas etiquetas</h4>
                  {labelList.map((l) => (
                    <label key={l.id} className="opt"><input type="checkbox" className="ct-check" checked={f.exclude.includes(l.id)} onChange={() => update({ exclude: toggleArr(f.exclude, l.id), include: f.include.filter((x) => x !== l.id) })} /><span className="sw" style={{ background: l.color }} />{l.name}</label>
                  ))}
                  <h4>Publicidad</h4>
                  <select className="ct-select" style={{ width: '100%' }} value={f.consent} onChange={(e) => update({ consent: e.target.value })} aria-label="Filtrar por consentimiento">
                    <option value="">Todos</option>
                    <option value="UNKNOWN">Sin constancia</option>
                    <option value="GRANTED">Con consentimiento</option>
                    <option value="REVOKED">Dado de baja</option>
                  </select>
                  <label className="opt" style={{ marginTop: 6 }}><input type="checkbox" className="ct-check" checked={f.invalid} onChange={(e) => update({ invalid: e.target.checked })} />Solo teléfono no válido</label>
                  {nFilters > 0 && <button className="btn ghost" onClick={() => { update({ include: [], exclude: [], consent: '', invalid: false }); filterDd.setOpen(false); }}>Quitar filtros</button>}
                </div>
              )}
            </div>
            <div className="ct-rel" ref={colDd.ref}>
              <button className="btn" onClick={() => colDd.setOpen(!colDd.open)} aria-expanded={colDd.open}>Columnas</button>
              {colDd.open && (
                <div className="ct-pop" style={{ top: '100%', left: 0, marginTop: 4 }} role="dialog" aria-label="Columnas">
                  {COLUMNS.map((c) => <label key={c.key} className="opt"><input type="checkbox" className="ct-check" checked={cols.has(c.key)} onChange={() => toggleCol(c.key)} />{c.label}</label>)}
                </div>
              )}
            </div>
            <select className="ct-select" value={f.sort} onChange={(e) => update({ sort: e.target.value })} aria-label="Ordenar por">
              <option value="name">Orden: nombre</option>
              <option value="createdAt">Orden: más recientes</option>
              <option value="lastActivity">Orden: última actividad</option>
            </select>
            <div className="hint row" style={{ marginLeft: 'auto', gap: 10 }}>
              Página de 100
              <button className="btn" style={{ height: 30 }} disabled={f.page <= 1} onClick={() => update({ page: f.page - 1 })} aria-label="Página anterior">‹</button>
              <span className="mono" aria-live="polite">{f.page} / {pages}</span>
              <button className="btn" style={{ height: 30 }} disabled={f.page >= pages} onClick={() => update({ page: f.page + 1 })} aria-label="Página siguiente">›</button>
            </div>
          </div>

          {selCount > 0 && (
            <div className="ct-bulk" role="region" aria-label="Acciones en bloque">
              <b>{fmtNumber(selCount)} seleccionado{selCount === 1 ? '' : 's'}</b>
              {selCount < total && <button className="lnk" onClick={selectAllMatching}>Seleccionar los {fmtNumber(total)} que coinciden</button>}
              <span className="ct-rel" ref={addDd.ref}>
                <button className="lnk" onClick={() => addDd.setOpen(!addDd.open)}>Añadir etiqueta</button>
                {addDd.open && <LabelMenu labels={labelList} onPick={(l) => { addDd.setOpen(false); bulk({ action: 'addLabel', labelId: l.id }, `Etiqueta ${l.name} añadida`); }} />}
              </span>
              <span className="ct-rel" ref={remDd.ref}>
                <button className="lnk" onClick={() => remDd.setOpen(!remDd.open)}>Quitar etiqueta</button>
                {remDd.open && <LabelMenu labels={labelList} onPick={(l) => { remDd.setOpen(false); bulk({ action: 'removeLabel', labelId: l.id }, `Etiqueta ${l.name} quitada`); }} />}
              </span>
              <button className="lnk" onClick={() => setModal('revoke')}>Dar de baja de publicidad</button>
              <button className="lnk" onClick={() => setModal('consent')}>Cambiar consentimiento…</button>
              {isAdmin && <button className="lnk" disabled={selCount > 150} title={selCount > 150 ? 'Para más de 150 contactos, filtra y usa «Exportar filtrados»' : undefined} onClick={() => exportCsv([...selected])}>Exportar selección</button>}
              <button className="lnk" style={{ marginLeft: 'auto' }} onClick={() => setSelected(new Set())}>Quitar selección</button>
            </div>
          )}

          <div className="panel tbl-wrap" aria-busy={list.isFetching}>
            <table>
              <thead>
                <tr>
                  <th style={{ width: 36 }}><input type="checkbox" className="ct-check" checked={pageSelected} onChange={togglePage} aria-label="Seleccionar la página" /></th>
                  <th>Nombre</th>
                  {cols.has('phone') && <th>Teléfono</th>}
                  {cols.has('email') && <th>Correo</th>}
                  {cols.has('company') && <th>Empresa</th>}
                  {cols.has('code') && <th>Código</th>}
                  {cols.has('taxId') && <th>CIF / DNI</th>}
                  {cols.has('landline') && <th>Teléfono fijo</th>}
                  {cols.has('labels') && <th>Etiquetas</th>}
                  {cols.has('consent') && <th>Publicidad</th>}
                  {cols.has('activity') && <th>Última actividad</th>}
                </tr>
              </thead>
              <tbody>
                {list.isLoading && <tr><td colSpan={12}><div className="empty"><Spinner /></div></td></tr>}
                {list.isError && <tr><td colSpan={12} className="err">No se han podido cargar los contactos. {errMsg(list.error)}</td></tr>}
                {!list.isLoading && !list.isError && items.length === 0 && (
                  <tr><td colSpan={12}><div className="empty">{f.q || nFilters ? 'Ningún contacto coincide con la búsqueda.' : 'Todavía no hay contactos. Impórtalos desde un CSV o crea el primero.'}</div></td></tr>
                )}
                {items.map((c) => (
                  <tr key={c.id} className={`ct-row${selected.has(c.id) ? ' sel' : ''}`} onClick={() => navigate(`/contactos/${c.id}`)}>
                    <td onClick={(e) => e.stopPropagation()}><input type="checkbox" className="ct-check" checked={selected.has(c.id)} onChange={() => toggle(c.id)} aria-label={`Seleccionar ${c.displayName}`} /></td>
                    <td style={{ fontWeight: 600 }}>{c.firstName || c.lastName || c.company ? c.displayName : <><span className="hint" style={{ fontWeight: 400 }}>Sin nombre</span>{c.profileName ? <span className="hint" style={{ fontWeight: 400 }}> · perfil «{c.profileName}»</span> : null}</>}</td>
                    {cols.has('phone') && <td className="mono">{formatPhone(c.phoneE164)}</td>}
                    {cols.has('email') && <td>{c.email}</td>}
                    {cols.has('company') && <td>{c.company}</td>}
                    {cols.has('code') && <td className="mono">{c.customerCode}</td>}
                    {cols.has('taxId') && <td className="mono">{c.taxId}</td>}
                    {cols.has('landline') && <td className="mono">{c.landline}</td>}
                    {cols.has('labels') && <td><span className="row" style={{ gap: 4 }}>{c.labels.map((l) => <LabelChip key={l.id} label={l} />)}</span></td>}
                    {cols.has('consent') && <td><span className="row" style={{ gap: 4 }}><ConsentPill status={c.consentStatus} />{c.phoneInvalid && <span className="pill p-warn">Teléfono no válido</span>}</span></td>}
                    {cols.has('activity') && <td className="hint">{fmtListTime(c.lastActivityAt)}</td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </main>

      {modal === 'new' && <NewContactModal onClose={() => setModal(null)} />}
      {modal === 'revoke' && (
        <ConsentChangeModal title="Dar de baja de publicidad" initial="REVOKED" count={selCount}
          onSubmit={async (dto: ConsentChangeDto) => bulk({ action: 'setConsent', consent: dto }, 'Consentimiento actualizado')} onClose={() => setModal(null)} />
      )}
      {modal === 'consent' && (
        <ConsentChangeModal initial="GRANTED" count={selCount}
          onSubmit={async (dto: ConsentChangeDto) => bulk({ action: 'setConsent', consent: dto }, 'Consentimiento actualizado')} onClose={() => setModal(null)} />
      )}
    </>
  );
}

function LabelMenu({ labels, onPick }: { labels: LabelDto[]; onPick: (l: LabelDto) => void }) {
  return (
    <div className="ct-pop" style={{ top: '100%', left: 0, marginTop: 4, color: 'var(--ink)' }} role="listbox" aria-label="Etiquetas">
      {labels.map((l) => (
        <button key={l.id} role="option" aria-selected={false} className="mi" style={{ border: 0, background: 'transparent', width: '100%', textAlign: 'left' }} onClick={() => onPick(l)}>
          <span className="sw" style={{ background: l.color }} />{l.name}
        </button>
      ))}
    </div>
  );
}

function NewContactModal({ onClose }: { onClose: () => void }) {
  const [f, setF] = useState({ phone: '', firstName: '', lastName: '', email: '', company: '', customerCode: '', taxId: '', landline: '' });
  const [error, setError] = useState('');
  const [existingId, setExistingId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();
  const refresh = useRefreshContact();
  const toast = useToast();
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError(''); setExistingId(null);
    try {
      const c = await api.post<ContactDto>('/api/contacts', Object.fromEntries(Object.entries(f).filter(([, v]) => v.trim())));
      refresh(c);
      toast('Contacto creado');
      onClose();
      navigate(`/contactos/${c.id}`);
    } catch (err: any) {
      setError(errMsg(err));
      setExistingId(err?.body?.details?.contactId ?? null);
    } finally {
      setBusy(false);
    }
  }
  const field = (k: keyof typeof f, label: string, type = 'text') => (
    <div><label className="label" htmlFor={`nc-${k}`}>{label}</label><input id={`nc-${k}`} className="field" type={type} value={f[k]} onChange={set(k)} /></div>
  );
  return (
    <Modal title="Nuevo contacto" onClose={onClose} width={560} footer={<>
      <button className="btn" onClick={onClose}>Cancelar</button>
      <button className="btn primary" form="nc-form" type="submit" disabled={busy || !f.phone.trim()}>Crear contacto</button>
    </>}>
      <form id="nc-form" onSubmit={submit} className="ct-fgrid">
        <div className="full">{field('phone', 'Teléfono móvil (WhatsApp) *')}<div className="hint" style={{ marginTop: 4 }}>Vale 617498222, +34 617 49 82 22 o un número extranjero con prefijo.</div></div>
        {field('firstName', 'Nombre')}
        {field('lastName', 'Apellidos')}
        {field('company', 'Empresa')}
        {field('email', 'Correo', 'email')}
        {field('customerCode', 'Código de cliente')}
        {field('taxId', 'CIF / DNI')}
        {field('landline', 'Teléfono fijo')}
        {error && <div className="err full" role="alert">{error}{existingId && <> · <Link to={`/contactos/${existingId}`} onClick={onClose}>Abrir el existente</Link></>}</div>}
      </form>
    </Modal>
  );
}
