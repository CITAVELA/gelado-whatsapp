import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { DEFAULT_SETTINGS, settingSchemas, type SettingKey, type BusinessHours, type OutOfHours, type Vacation, type Rates, type CampaignDefaults, type PrivacyPolicy } from '@gelado/shared';
import { PrismaService } from '../../common/prisma.service';

export interface SettingValues {
  business_hours: BusinessHours;
  out_of_hours: OutOfHours;
  vacation: Vacation;
  rates: Rates;
  campaign_defaults: CampaignDefaults;
  privacy_policy: PrivacyPolicy;
}

/** Lectura/escritura de ajustes (tabla Setting) validados con los esquemas de @gelado/shared. */
@Injectable()
export class SettingsService {
  constructor(private readonly prisma: PrismaService) {}

  async get<K extends SettingKey>(key: K): Promise<SettingValues[K]> {
    const row = await this.prisma.setting.findUnique({ where: { key } });
    const schema = settingSchemas[key];
    if (row) {
      const r = schema.safeParse(row.value);
      if (r.success) return r.data as SettingValues[K];
    }
    if (key === 'privacy_policy') return { markdown: '', updatedAt: new Date(0).toISOString() } as SettingValues[K];
    return (DEFAULT_SETTINGS as any)[key] as SettingValues[K];
  }

  async set<K extends SettingKey>(key: K, value: unknown, userId?: string | null): Promise<SettingValues[K]> {
    const parsed = settingSchemas[key].parse(value) as SettingValues[K];
    await this.prisma.setting.upsert({
      where: { key },
      create: { key, value: parsed as Prisma.InputJsonValue, updatedById: userId ?? null },
      update: { value: parsed as Prisma.InputJsonValue, updatedById: userId ?? null },
    });
    return parsed;
  }

  async all(): Promise<Omit<SettingValues, 'privacy_policy'>> {
    const [business_hours, out_of_hours, vacation, rates, campaign_defaults] = await Promise.all([
      this.get('business_hours'), this.get('out_of_hours'), this.get('vacation'), this.get('rates'), this.get('campaign_defaults'),
    ]);
    return { business_hours, out_of_hours, vacation, rates, campaign_defaults };
  }
}
