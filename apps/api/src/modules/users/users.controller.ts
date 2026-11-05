import { BadRequestException, Body, ConflictException, Controller, Get, NotFoundException, Param, ParseUUIDPipe, Patch, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { inviteUserSchema, updateUserSchema, type InviteUserDto, type UpdateUserDto } from '@gelado/shared';
import { PrismaService } from '../../common/prisma.service';
import { AdminOnly, CurrentUser, type AuthUser } from '../../common/decorators';
import { ZodPipe } from '../../common/zod.pipe';
import { AuthService } from '../auth/auth.service';
import { AuditService } from '../audit/audit.service';
import { clientIp } from '../auth/auth.controller';

@Controller('api/users')
export class UsersController {
  constructor(private readonly prisma: PrismaService, private readonly auth: AuthService, private readonly audit: AuditService) {}

  @Get()
  async list() {
    const users = await this.prisma.user.findMany({
      orderBy: [{ active: 'desc' }, { name: 'asc' }],
      include: { resetTokens: { select: { purpose: true, usedAt: true, expiresAt: true } } },
    });
    return users.map((u) => AuthService.toUserDto(u));
  }

  @Post()
  @AdminOnly()
  async invite(@Body(new ZodPipe(inviteUserSchema)) dto: InviteUserDto, @CurrentUser() me: AuthUser, @Req() req: Request) {
    const exists = await this.prisma.user.findUnique({ where: { email: dto.email } });
    if (exists) throw new ConflictException({ statusCode: 409, message: 'Ya existe un usuario con ese correo' });
    const user = await this.prisma.user.create({ data: { email: dto.email, name: dto.name, role: dto.role, passwordHash: '' } });
    const link = await this.auth.createTokenLink(user.id, 'INVITE');
    await this.audit.log({ userId: me.id, action: 'invite_user', entityType: 'User', entityId: user.id, data: { email: dto.email, role: dto.role }, ip: clientIp(req) });
    return { user: AuthService.toUserDto({ ...user, resetTokens: [{ purpose: 'INVITE', usedAt: null, expiresAt: new Date(link.expiresAt) }] }), link };
  }

  @Patch(':id')
  @AdminOnly()
  async update(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(updateUserSchema)) dto: UpdateUserDto, @CurrentUser() me: AuthUser, @Req() req: Request) {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) throw new NotFoundException({ statusCode: 404, message: 'Usuario no encontrado' });
    if (id === me.id && (dto.active === false || dto.role === 'AGENT')) {
      throw new BadRequestException({ statusCode: 400, message: 'No puedes quitarte a ti misma el acceso ni el rol de administradora' });
    }
    const updated = await this.prisma.user.update({ where: { id }, data: dto });
    if (dto.active === false) await this.prisma.session.deleteMany({ where: { userId: id } });
    await this.audit.log({ userId: me.id, action: 'update_user', entityType: 'User', entityId: id, data: dto, ip: clientIp(req) });
    return AuthService.toUserDto(updated);
  }

  @Post(':id/reset-link')
  @AdminOnly()
  async resetLink(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() me: AuthUser, @Req() req: Request) {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) throw new NotFoundException({ statusCode: 404, message: 'Usuario no encontrado' });
    const link = await this.auth.createTokenLink(id, 'RESET');
    await this.audit.log({ userId: me.id, action: 'reset_link', entityType: 'User', entityId: id, ip: clientIp(req) });
    return link;
  }

  @Post(':id/invite-link')
  @AdminOnly()
  async inviteLink(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() me: AuthUser, @Req() req: Request) {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) throw new NotFoundException({ statusCode: 404, message: 'Usuario no encontrado' });
    const link = await this.auth.createTokenLink(id, 'INVITE');
    await this.audit.log({ userId: me.id, action: 'invite_link', entityType: 'User', entityId: id, ip: clientIp(req) });
    return link;
  }
}
