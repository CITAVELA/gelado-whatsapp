import { LABELS_ES, type TemplateDto, type TemplateStatus } from '@gelado/shared';

const STATUS_CLASS: Record<TemplateStatus, string> = {
  LOCAL_DRAFT: 'p-grey',
  PENDING: 'p-warn',
  APPROVED: 'p-ok',
  REJECTED: 'p-bad',
  PAUSED: 'p-warn',
  DISABLED: 'p-bad',
  IN_APPEAL: 'p-blue',
  DELETED: 'p-grey',
};

export function TemplateStatusChip({ status }: { status: TemplateStatus }) {
  return <span className={`pill ${STATUS_CLASS[status] ?? 'p-grey'}`}>{status === 'PENDING' ? 'En revisión de Meta' : LABELS_ES.templateStatus[status]}</span>;
}

/** Marca roja de RF-4.5: marketing sin botón «No recibir más». */
export function NoOptOutPill({ t }: { t: Pick<TemplateDto, 'category' | 'hasOptOutButton'> }) {
  if (t.category !== 'MARKETING' || t.hasOptOutButton) return null;
  return <span className="pill p-bad" title="No se puede usar en campañas hasta duplicarla con el botón «No recibir más»">Sin botón de baja</span>;
}

export function QualityPill({ score }: { score: string | null }) {
  const m: Record<string, [string, string]> = { GREEN: ['Alta', 'p-ok'], YELLOW: ['Media', 'p-warn'], RED: ['Baja', 'p-bad'] };
  const x = score ? m[score.toUpperCase()] : undefined;
  return x ? <span className={`pill ${x[1]}`}>{x[0]}</span> : <span className="hint">—</span>;
}

/** «buenos_dias» → «Buenos dias» cuando no hay nombre legible (plantillas sincronizadas). */
export function templateTitle(t: Pick<TemplateDto, 'displayName' | 'name'>) {
  if (t.displayName) return t.displayName;
  const s = t.name.replace(/_/g, ' ');
  return s.charAt(0).toUpperCase() + s.slice(1);
}
