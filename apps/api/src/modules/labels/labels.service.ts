import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { LabelDto, LabelScope, LabelUpsertDto } from '@gelado/shared';
import { PrismaService } from '../../common/prisma.service';
import { AuditService } from '../audit/audit.service';
import { toLabelDto } from '../inbox/mappers';

@Injectable()
export class LabelsService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService) {}

  async list(scope?: LabelScope): Promise<LabelDto[]> {
    const rows = await this.prisma.label.findMany({
      where: scope ? { scope } : undefined,
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });
    return rows.map(toLabelDto);
  }

  async create(dto: LabelUpsertDto, userId: string): Promise<LabelDto> {
    try {
      const l = await this.prisma.label.create({ data: dto });
      await this.audit.log({ userId, action: 'label_change', entityType: 'Label', entityId: l.id, data: { op: 'create', name: l.name } });
      return toLabelDto(l);
    } catch (e) {
      throw this.dupe(e);
    }
  }

  async update(id: string, dto: Partial<LabelUpsertDto>, userId: string): Promise<LabelDto> {
    const prev = await this.prisma.label.findUnique({ where: { id } });
    if (!prev) throw new NotFoundException({ statusCode: 404, message: 'Etiqueta no encontrada' });
    try {
      // el ámbito no se cambia: las asignaciones existentes dejarían de tener sentido
      const { scope: _scope, ...data } = dto;
      const l = await this.prisma.label.update({ where: { id }, data });
      await this.audit.log({ userId, action: 'label_change', entityType: 'Label', entityId: id, data: { op: 'update', from: prev.name, to: l.name } });
      return toLabelDto(l);
    } catch (e) {
      throw this.dupe(e);
    }
  }

  async remove(id: string, userId: string) {
    const prev = await this.prisma.label.findUnique({ where: { id } });
    if (!prev) throw new NotFoundException({ statusCode: 404, message: 'Etiqueta no encontrada' });
    await this.prisma.label.delete({ where: { id } });
    await this.audit.log({ userId, action: 'label_change', entityType: 'Label', entityId: id, data: { op: 'delete', name: prev.name } });
    return { ok: true };
  }

  private dupe(e: unknown) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
      return new ConflictException({ statusCode: 409, message: 'Ya existe una etiqueta con ese nombre' });
    }
    return e;
  }
}
