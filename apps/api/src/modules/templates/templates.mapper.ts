import type { Template } from '@prisma/client';
import { hasOptOutButton, templateVariableKeys, type TemplateComponent, type TemplateDto, type TemplateStatus, type TemplateCategory } from '@gelado/shared';

/** Estado de Meta → estado local. Los desconocidos se tratan como pendientes. */
export function mapMetaStatus(s: string | undefined | null): TemplateStatus {
  switch ((s ?? '').toUpperCase()) {
    case 'APPROVED':
    case 'REINSTATED':
      return 'APPROVED';
    case 'REJECTED':
      return 'REJECTED';
    case 'PAUSED':
    case 'LIMIT_EXCEEDED':
      return 'PAUSED';
    case 'DISABLED':
    case 'ARCHIVED':
      return 'DISABLED';
    case 'IN_APPEAL':
      return 'IN_APPEAL';
    case 'DELETED':
    case 'PENDING_DELETION':
      return 'DELETED';
    default:
      return 'PENDING';
  }
}

export function mapMetaCategory(c: string | undefined | null): TemplateCategory {
  const u = (c ?? '').toUpperCase();
  return u === 'UTILITY' || u === 'AUTHENTICATION' ? (u as TemplateCategory) : 'MARKETING';
}

const REJECTION_ES: Record<string, string> = {
  ABUSIVE_CONTENT: 'Contenido abusivo',
  INCORRECT_CATEGORY: 'Categoría incorrecta',
  INVALID_FORMAT: 'Formato no válido',
  SCAM: 'Posible estafa',
  PROMOTIONAL: 'Contenido promocional en una plantilla de utilidad',
  TAG_CONTENT_MISMATCH: 'El contenido no coincide con la categoría',
};

/** Motivo de rechazo legible. `NONE`/vacío = sin motivo. */
export function rejectionReasonEs(reason: string | undefined | null): string | null {
  if (!reason || reason.toUpperCase() === 'NONE') return null;
  const es = REJECTION_ES[reason.toUpperCase()];
  return es ? `${es} (${reason})` : reason;
}

export function headerFormatOf(components: TemplateComponent[]): TemplateDto['headerFormat'] {
  const h = components.find((c) => c.type === 'HEADER');
  return (h?.format ?? 'NONE') as TemplateDto['headerFormat'];
}

export function toTemplateDto(t: Template): TemplateDto {
  const components = (t.components ?? []) as unknown as TemplateComponent[];
  const category = t.category as TemplateCategory;
  const status = t.status as TemplateStatus;
  return {
    id: t.id,
    metaTemplateId: t.metaTemplateId,
    name: t.name,
    displayName: t.displayName,
    language: t.language,
    category,
    status,
    components,
    rejectedReason: t.rejectedReason,
    qualityScore: t.qualityScore,
    hasOptOutButton: t.hasOptOutButton,
    variables: templateVariableKeys(components),
    headerFormat: headerFormatOf(components),
    usableInCampaigns: status === 'APPROVED' && (category !== 'MARKETING' || t.hasOptOutButton),
    lastSyncedAt: t.lastSyncedAt?.toISOString() ?? null,
    updatedAt: t.updatedAt.toISOString(),
  };
}

export { hasOptOutButton };
