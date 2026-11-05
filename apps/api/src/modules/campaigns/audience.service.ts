import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { estimateCampaignCost, zonedParts, WINDOW_MS, type AudienceCountDto, type AudienceDto } from '@gelado/shared';
import { PrismaService } from '../../common/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { CampaignClock } from './campaigns.clock';

export type ExclusionReason = 'EXCLUDED_LABEL' | 'DELETED' | 'REVOKED' | 'NO_PHONE' | 'PHONE_INVALID' | 'DUPLICATE';

export interface ResolvedContact {
  contactId: string;
  phoneE164: string | null;
  /** null = recibirá la campaña */
  excluded: ExclusionReason | null;
}

export interface Batch {
  at: Date;
  count: number;
}

/** Normaliza el teléfono para detectar duplicados: wa_id si existe, si no los dígitos del E.164. */
function phoneKey(c: { waId: string | null; phoneE164: string }) {
  return (c.waId ?? c.phoneE164).replace(/\D/g, '');
}

/**
 * Audiencia de una campaña (RF-5.2/5.3). Las exclusiones automáticas (borrados, bajas, teléfonos
 * inválidos y duplicados) se aplican SIEMPRE, también a la selección manual.
 */
@Injectable()
export class AudienceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly clock: CampaignClock,
  ) {}

  /** Contactos de la audiencia, cada uno con su motivo de exclusión (o null). Orden estable: alta y id. */
  async resolve(aud: AudienceDto): Promise<ResolvedContact[]> {
    const include = aud.includeLabelIds ?? [];
    const manual = aud.contactIds ?? [];
    const or: Prisma.ContactWhereInput[] = [];
    if (include.length) or.push({ labels: { some: { labelId: { in: include } } } });
    if (manual.length) or.push({ id: { in: manual } });
    const everyone = !include.length && aud.allContacts;
    if (!or.length && !everyone) return [];

    const contacts = await this.prisma.contact.findMany({
      where: everyone ? {} : { OR: or },
      select: { id: true, phoneE164: true, waId: true, consentStatus: true, phoneInvalid: true, deletedAt: true },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    const exclude = aud.excludeLabelIds ?? [];
    const excludedByLabel = exclude.length
      ? new Set((await this.prisma.contactLabel.findMany({ where: { labelId: { in: exclude } }, select: { contactId: true } })).map((r) => r.contactId))
      : new Set<string>();

    const seenPhones = new Set<string>();
    return contacts.map((c) => {
      let excluded: ExclusionReason | null = null;
      if (excludedByLabel.has(c.id)) excluded = 'EXCLUDED_LABEL';
      else if (c.deletedAt) excluded = 'DELETED';
      else if (c.consentStatus === 'REVOKED') excluded = 'REVOKED';
      else if (!c.phoneE164) excluded = 'NO_PHONE'; // sin teléfono no hay WhatsApp (P16), también en selección manual
      else if (c.phoneInvalid) excluded = 'PHONE_INVALID';
      else {
        const k = phoneKey({ waId: c.waId, phoneE164: c.phoneE164 });
        if (seenPhones.has(k)) excluded = 'DUPLICATE';
        else seenPhones.add(k);
      }
      return { contactId: c.id, phoneE164: c.phoneE164, excluded };
    });
  }

  /** Destinatarios únicos con plantillas fuera de ventana en las últimas 24 h móviles (cualquier origen). */
  async usedLast24h(now = this.clock.now()): Promise<number> {
    const since = new Date(now.getTime() - WINDOW_MS);
    const r = await this.prisma.$queryRaw<{ n: number }[]>(Prisma.sql`
      SELECT count(DISTINCT "conversationId")::int AS n FROM "Message"
      WHERE "direction" = 'OUTBOUND' AND "sentOutsideWindow" = true AND "status" <> 'FAILED'
        AND "createdAt" >= ${since}`);
    return r[0]?.n ?? 0;
  }

  /** Reparto en tandas: la primera con lo que cabe ahora y después `limit` cada 24 h. */
  planBatches(count: number, limit: number, used: number, start: Date): Batch[] {
    const out: Batch[] = [];
    let left = count;
    let k = 0;
    let cap = Math.max(0, limit - used);
    while (left > 0 && out.length < 400) {
      const n = Math.min(left, cap);
      if (n > 0) out.push({ at: new Date(start.getTime() + k * WINDOW_MS), count: n });
      left -= n;
      k += 1;
      cap = limit;
    }
    return out;
  }

  batchesToDays(batches: Batch[]): Array<{ day: string; count: number }> {
    const days = new Map<string, number>();
    for (const b of batches) {
      const d = zonedParts(b.at).ymd;
      days.set(d, (days.get(d) ?? 0) + b.count);
    }
    return [...days].map(([day, count]) => ({ day, count }));
  }

  /** Recuento en vivo con desglose, coste, duración y reparto por días. */
  async count(input: { audience: AudienceDto; templateId?: string | null; ratePerMinute?: number; scheduledAt?: string | null }): Promise<AudienceCountDto> {
    const [rows, defaults, rates] = await Promise.all([this.resolve(input.audience), this.settings.get('campaign_defaults'), this.settings.get('rates')]);
    const by = (r: ExclusionReason) => rows.filter((x) => x.excluded === r).length;
    const willReceive = rows.filter((x) => !x.excluded).length;
    const now = this.clock.now();
    const sched = input.scheduledAt ? new Date(input.scheduledAt) : null;
    const start = sched && sched > now ? sched : now;
    const used = await this.usedLast24h(now);
    // Una campaña programada para dentro de más de 24 h no hereda el uso actual
    const usedAtStart = start.getTime() - now.getTime() >= WINDOW_MS ? 0 : used;
    const rate = input.ratePerMinute ?? defaults.ratePerMinute;
    let category: 'MARKETING' | 'UTILITY' | 'AUTHENTICATION' = 'MARKETING';
    if (input.templateId) {
      const t = await this.prisma.template.findUnique({ where: { id: input.templateId }, select: { category: true } });
      if (t) category = t.category as typeof category;
    }
    return {
      selected: rows.length,
      excludedByLabel: by('EXCLUDED_LABEL'),
      excludedDeleted: by('DELETED'),
      excludedRevoked: by('REVOKED'),
      excludedInvalid: by('PHONE_INVALID'),
      excludedDuplicate: by('DUPLICATE'),
      excludedNoPhone: by('NO_PHONE'),
      willReceive,
      dailyLimit: defaults.dailyLimit,
      usedLast24h: used,
      plan: this.batchesToDays(this.planBatches(willReceive, defaults.dailyLimit, usedAtStart, start)),
      estimatedCost: estimateCampaignCost(willReceive, category, rates),
      estimatedMinutes: Math.ceil(willReceive / Math.max(1, rate)),
    };
  }
}
