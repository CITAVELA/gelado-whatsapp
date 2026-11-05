import { z } from 'zod';
import type { LabelScope } from './enums';

export interface LabelDto {
  id: string;
  name: string;
  color: string;
  scope: LabelScope;
  showAsInboxView: boolean;
  sortOrder: number;
}

export const labelUpsertSchema = z.object({
  name: z.string().trim().min(1).max(40).transform((s) => s.toUpperCase()),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Color hex #RRGGBB'),
  scope: z.enum(['CONTACT', 'CONVERSATION']),
  showAsInboxView: z.boolean().default(false),
  sortOrder: z.number().int().default(0),
});
export type LabelUpsertDto = z.infer<typeof labelUpsertSchema>;
