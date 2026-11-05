import { Global, Injectable, Module, Controller, Get, Query } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma.service';
import { AdminOnly } from '../../common/decorators';

export type AuditAction =
  | 'login' | 'logout' | 'login_failed' | 'set_password'
  | 'invite_user' | 'update_user' | 'reset_link' | 'invite_link'
  | 'export_contacts' | 'delete_contact' | 'hard_delete_contact' | 'import_contacts' | 'consent_change'
  | 'create_template' | 'delete_template' | 'sync_templates'
  | 'launch_campaign' | 'schedule_campaign' | 'pause_campaign' | 'resume_campaign' | 'cancel_campaign' | 'test_campaign' | 'export_campaign' | 'delete_campaign'
  | 'update_setting' | 'library_upload' | 'library_delete' | 'label_change'
  | string;

@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  /** Registra una acción sensible (RF-1.5). Nunca lanza: un fallo de auditoría no rompe la acción. */
  async log(input: { userId?: string | null; action: AuditAction; entityType?: string; entityId?: string; data?: unknown; ip?: string | null }) {
    try {
      await this.prisma.auditLog.create({
        data: {
          userId: input.userId ?? null,
          action: input.action,
          entityType: input.entityType,
          entityId: input.entityId,
          data: (input.data as Prisma.InputJsonValue) ?? undefined,
          ip: input.ip ?? null,
        },
      });
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('[audit] no se pudo registrar', input.action, e);
    }
  }

  async list(q: { action?: string; userId?: string; from?: string; to?: string; page?: number; pageSize?: number }) {
    const page = Math.max(1, Number(q.page) || 1);
    const pageSize = Math.min(200, Math.max(1, Number(q.pageSize) || 50));
    const where: Prisma.AuditLogWhereInput = {
      action: q.action || undefined,
      userId: q.userId || undefined,
      createdAt: q.from || q.to ? { gte: q.from ? new Date(q.from) : undefined, lte: q.to ? new Date(q.to) : undefined } : undefined,
    };
    const [items, total] = await Promise.all([
      this.prisma.auditLog.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (page - 1) * pageSize, take: pageSize, include: { user: { select: { name: true } } } }),
      this.prisma.auditLog.count({ where }),
    ]);
    return {
      items: items.map((a) => ({ id: a.id, action: a.action, entityType: a.entityType, entityId: a.entityId, data: a.data, ip: a.ip, userName: a.user?.name ?? null, createdAt: a.createdAt.toISOString() })),
      total, page, pageSize,
    };
  }
}

@Controller('api/audit')
export class AuditController {
  constructor(private readonly audit: AuditService) {}
  @Get()
  @AdminOnly()
  list(@Query() q: Record<string, string>) {
    return this.audit.list({ ...q, page: Number(q.page), pageSize: Number(q.pageSize) });
  }
}

@Global()
@Module({ providers: [AuditService], controllers: [AuditController], exports: [AuditService] })
export class AuditModule {}
