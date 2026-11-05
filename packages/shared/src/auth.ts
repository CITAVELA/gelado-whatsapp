import { z } from 'zod';
import type { Role } from './enums';

export const PASSWORD_MIN = 10;

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email('Correo no válido'),
  password: z.string().min(1, 'Escribe la contraseña'),
});
export type LoginDto = z.infer<typeof loginSchema>;

/** Aceptar invitación o nueva contraseña con el enlace de un solo uso. */
export const setPasswordSchema = z.object({
  token: z.string().min(20),
  password: z.string().min(PASSWORD_MIN, `Mínimo ${PASSWORD_MIN} caracteres`).max(200),
});
export type SetPasswordDto = z.infer<typeof setPasswordSchema>;

export interface MeDto {
  id: string;
  email: string;
  name: string;
  role: Role;
}

export interface UserDto extends MeDto {
  active: boolean;
  lastLoginAt: string | null;
  createdAt: string;
  hasPassword: boolean;
  pendingInvite: boolean;
}

export const inviteUserSchema = z.object({
  email: z.string().trim().toLowerCase().email('Correo no válido'),
  name: z.string().trim().min(1).max(120),
  role: z.enum(['ADMIN', 'AGENT']).default('AGENT'),
});
export type InviteUserDto = z.infer<typeof inviteUserSchema>;

export const updateUserSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  role: z.enum(['ADMIN', 'AGENT']).optional(),
  active: z.boolean().optional(),
});
export type UpdateUserDto = z.infer<typeof updateUserSchema>;

/** Enlace generado (invitación o nueva contraseña). Se muestra una sola vez para copiarlo. */
export interface TokenLinkDto {
  url: string;
  expiresAt: string;
  purpose: 'INVITE' | 'RESET';
}

export interface TokenInfoDto {
  valid: boolean;
  purpose?: 'INVITE' | 'RESET';
  email?: string;
  name?: string;
}

export const INVITE_TTL_HOURS = 24 * 7;
export const RESET_TTL_HOURS = 24;
