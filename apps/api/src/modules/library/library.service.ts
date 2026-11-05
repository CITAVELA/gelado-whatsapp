import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, type LibraryFile, type MediaFile } from '@prisma/client';
import { validateMediaForWhatsApp, type LibraryFileDto, type LibraryFolderDto } from '@gelado/shared';
import { PrismaService } from '../../common/prisma.service';
import { AuditService } from '../audit/audit.service';
import { MediaService } from '../media/media.service';
import { StorageService } from '../storage/storage.service';

const nf = (what: string) => new NotFoundException({ statusCode: 404, message: `${what} no encontrada` });

@Injectable()
export class LibraryService {
  constructor(private readonly prisma: PrismaService, private readonly media: MediaService, private readonly storage: StorageService, private readonly audit: AuditService) {}

  // ───── Carpetas ─────

  async folders(): Promise<LibraryFolderDto[]> {
    const rows = await this.prisma.libraryFolder.findMany({ orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }], include: { _count: { select: { files: true } } } });
    return rows.map((f) => ({ id: f.id, name: f.name, parentId: f.parentId, sortOrder: f.sortOrder, fileCount: f._count.files }));
  }

  async createFolder(dto: { name: string; parentId?: string | null }): Promise<LibraryFolderDto> {
    if (dto.parentId) await this.folderOrThrow(dto.parentId);
    const max = await this.prisma.libraryFolder.aggregate({ where: { parentId: dto.parentId ?? null }, _max: { sortOrder: true } });
    const f = await this.prisma.libraryFolder.create({ data: { name: dto.name, parentId: dto.parentId ?? null, sortOrder: (max._max.sortOrder ?? 0) + 1 } });
    return { id: f.id, name: f.name, parentId: f.parentId, sortOrder: f.sortOrder, fileCount: 0 };
  }

  async updateFolder(id: string, dto: { name?: string; parentId?: string | null }): Promise<LibraryFolderDto> {
    await this.folderOrThrow(id);
    if (dto.parentId) {
      await this.folderOrThrow(dto.parentId);
      // no meter una carpeta dentro de sí misma ni de sus descendientes
      for (let cur: string | null = dto.parentId; cur; ) {
        if (cur === id) throw new BadRequestException({ statusCode: 400, message: 'No se puede mover una carpeta dentro de sí misma' });
        cur = (await this.prisma.libraryFolder.findUnique({ where: { id: cur }, select: { parentId: true } }))?.parentId ?? null;
      }
    }
    await this.prisma.libraryFolder.update({ where: { id }, data: { ...(dto.name !== undefined ? { name: dto.name } : {}), ...(dto.parentId !== undefined ? { parentId: dto.parentId } : {}) } });
    return (await this.folders()).find((f) => f.id === id)!;
  }

  async deleteFolder(id: string) {
    await this.folderOrThrow(id);
    const [files, children] = await Promise.all([this.prisma.libraryFile.count({ where: { folderId: id } }), this.prisma.libraryFolder.count({ where: { parentId: id } })]);
    if (files || children) throw new ConflictException({ statusCode: 409, message: 'La carpeta no está vacía: mueve o borra antes su contenido' });
    await this.prisma.libraryFolder.delete({ where: { id } });
  }

  private async folderOrThrow(id: string) {
    const f = await this.prisma.libraryFolder.findUnique({ where: { id } });
    if (!f) throw nf('Carpeta');
    return f;
  }

  // ───── Archivos ─────

  private async toDto(f: LibraryFile & { media: MediaFile }): Promise<LibraryFileDto> {
    return { id: f.id, folderId: f.folderId, name: f.name, media: await this.media.toDto(f.media), createdAt: f.createdAt.toISOString() };
  }

  async files(q: { folderId?: string; q?: string }): Promise<LibraryFileDto[]> {
    const where: Prisma.LibraryFileWhereInput = {
      ...(q.folderId ? { folderId: q.folderId } : {}),
      ...(q.q?.trim() ? { name: { contains: q.q.trim(), mode: 'insensitive' } } : {}),
    };
    const rows = await this.prisma.libraryFile.findMany({ where, include: { media: true }, orderBy: [{ name: 'asc' }] });
    await this.storage.primeSignedUrls(rows.map((r) => r.media.storagePath)); // una sola petición de firma para toda la lista
    return Promise.all(rows.map((r) => this.toDto(r)));
  }

  async upload(file: { buffer: Buffer; mimetype: string; originalname: string; size: number }, dto: { name?: string; folderId?: string | null }, userId: string, ip?: string | null): Promise<LibraryFileDto> {
    const check = validateMediaForWhatsApp(file.mimetype, file.size);
    if (!check.ok) throw new BadRequestException({ statusCode: 400, message: check.reason });
    if (!file.size) throw new BadRequestException({ statusCode: 400, message: 'El archivo está vacío' });
    if (dto.folderId) await this.folderOrThrow(dto.folderId);
    const fileName = Buffer.from(file.originalname, 'latin1').toString('utf8');
    const m = await this.media.storeBuffer(file.buffer, file.mimetype, fileName, 'LIBRARY', userId);
    const name = (dto.name?.trim() || fileName.replace(/\.[a-z0-9]{1,5}$/i, '')).slice(0, 160);
    const lf = await this.prisma.libraryFile.create({ data: { name, folderId: dto.folderId ?? null, mediaFileId: m.id, createdById: userId }, include: { media: true } });
    await this.audit.log({ userId, action: 'library_upload', entityType: 'LibraryFile', entityId: lf.id, data: { name, mimeType: file.mimetype, sizeBytes: file.size }, ip });
    return this.toDto(lf);
  }

  async updateFile(id: string, dto: { name?: string; folderId?: string | null }): Promise<LibraryFileDto> {
    const cur = await this.prisma.libraryFile.findUnique({ where: { id } });
    if (!cur) throw nf('Archivo');
    if (dto.folderId) await this.folderOrThrow(dto.folderId);
    const lf = await this.prisma.libraryFile.update({
      where: { id },
      data: { ...(dto.name !== undefined ? { name: dto.name } : {}), ...(dto.folderId !== undefined ? { folderId: dto.folderId } : {}) },
      include: { media: true },
    });
    return this.toDto(lf);
  }

  /** Borra la entrada; el archivo en Storage solo si ningún mensaje ni otra entrada lo usa. */
  async deleteFile(id: string, userId?: string | null, ip?: string | null) {
    const lf = await this.prisma.libraryFile.findUnique({ where: { id }, include: { media: true } });
    if (!lf) throw nf('Archivo');
    await this.prisma.libraryFile.delete({ where: { id } });
    await this.audit.log({ userId, action: 'library_delete', entityType: 'LibraryFile', entityId: id, data: { name: lf.name }, ip });
    const [msgs, others] = await Promise.all([
      this.prisma.message.count({ where: { mediaId: lf.mediaFileId } }),
      this.prisma.libraryFile.count({ where: { mediaFileId: lf.mediaFileId } }),
    ]);
    if (!msgs && !others) {
      await this.prisma.mediaFile.delete({ where: { id: lf.mediaFileId } });
      await this.storage.remove([lf.media.storagePath]).catch(() => undefined);
    }
  }
}
