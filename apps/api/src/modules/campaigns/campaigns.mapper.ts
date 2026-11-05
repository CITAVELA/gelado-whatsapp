import type { Prisma } from '@prisma/client';
import { audienceSchema, type CampaignDto, type CampaignRecipientDto, type VariableSource } from '@gelado/shared';
import { contactDisplayName } from '../inbox/mappers';

export const campaignInclude = {
  template: { select: { id: true, name: true, displayName: true, category: true, status: true, components: true, hasOptOutButton: true } },
  createdBy: { select: { id: true, name: true } },
} satisfies Prisma.CampaignInclude;
export type CampaignRow = Prisma.CampaignGetPayload<{ include: typeof campaignInclude }>;

export function toCampaignDto(c: CampaignRow, extra: { actualCost?: number | null } = {}): CampaignDto {
  const audience = audienceSchema.safeParse(c.audience);
  return {
    id: c.id,
    name: c.name,
    templateId: c.templateId,
    templateName: c.template.displayName ?? c.template.name,
    variableMapping: (c.variableMapping ?? {}) as Record<string, VariableSource>,
    headerMediaFileId: c.headerMediaId,
    audience: audience.success ? audience.data : { includeLabelIds: [], excludeLabelIds: [], allContacts: false },
    status: c.status,
    scheduledAt: c.scheduledAt?.toISOString() ?? null,
    startedAt: c.startedAt?.toISOString() ?? null,
    completedAt: c.completedAt?.toISOString() ?? null,
    ratePerMinute: c.ratePerMinute,
    stopReason: c.stopReason,
    estimatedCost: c.estimatedCost != null ? Number(c.estimatedCost) : null,
    actualCost: extra.actualCost ?? null,
    currency: c.currency,
    totalRecipients: c.totalRecipients,
    sentCount: c.sentCount,
    deliveredCount: c.deliveredCount,
    readCount: c.readCount,
    repliedCount: c.repliedCount,
    failedCount: c.failedCount,
    skippedCount: c.skippedCount,
    optOutCount: c.optOutCount,
    createdBy: c.createdBy,
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt.toISOString(),
  };
}

export const recipientInclude = {
  contact: { select: { id: true, firstName: true, lastName: true, profileName: true, company: true, phoneE164: true, email: true, customerCode: true, conversation: { select: { id: true } } } },
} satisfies Prisma.CampaignRecipientInclude;
export type RecipientRow = Prisma.CampaignRecipientGetPayload<{ include: typeof recipientInclude }>;

export function toRecipientDto(r: RecipientRow): CampaignRecipientDto {
  return {
    id: r.id,
    contactId: r.contactId,
    conversationId: r.contact.conversation?.id ?? null,
    displayName: contactDisplayName(r.contact),
    phoneE164: r.phoneE164,
    status: r.status,
    skipReason: r.skipReason,
    plannedFor: r.plannedFor?.toISOString() ?? null,
    errorCode: r.errorCode,
    errorTitle: r.errorTitle,
    sentAt: r.sentAt?.toISOString() ?? null,
    deliveredAt: r.deliveredAt?.toISOString() ?? null,
    readAt: r.readAt?.toISOString() ?? null,
    repliedAt: r.repliedAt?.toISOString() ?? null,
    optedOutAt: r.optedOutAt?.toISOString() ?? null,
  };
}
