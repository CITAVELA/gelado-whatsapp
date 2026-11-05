import { BadRequestException, Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Query, UploadedFile, UseInterceptors } from '@nestjs/common';
import { libraryFileUpdateSchema, libraryFolderSchema } from '@gelado/shared';
import { AdminOnly, CurrentUser, type AuthUser } from '../../common/decorators';
import { ZodPipe } from '../../common/zod.pipe';
import { UploadInterceptor } from '../media/media.controller';
import { LibraryService } from './library.service';

const uuid = new ParseUUIDPipe({ exceptionFactory: () => new BadRequestException({ statusCode: 400, message: 'Identificador no válido' }) });
const folderUpdate = libraryFolderSchema.partial();

@Controller('api/library')
export class LibraryController {
  constructor(private readonly lib: LibraryService) {}

  @Get('folders')
  folders() {
    return this.lib.folders();
  }

  @Post('folders')
  @AdminOnly()
  createFolder(@Body(new ZodPipe(libraryFolderSchema)) dto: { name: string; parentId?: string | null }) {
    return this.lib.createFolder(dto);
  }

  @Patch('folders/:id')
  @AdminOnly()
  updateFolder(@Param('id', uuid) id: string, @Body(new ZodPipe(folderUpdate)) dto: { name?: string; parentId?: string | null }) {
    return this.lib.updateFolder(id, dto);
  }

  @Delete('folders/:id')
  @AdminOnly()
  async deleteFolder(@Param('id', uuid) id: string) {
    await this.lib.deleteFolder(id);
    return { ok: true };
  }

  @Get('files')
  files(@Query('folderId') folderId?: string, @Query('q') q?: string) {
    if (folderId && !/^[0-9a-f-]{36}$/i.test(folderId)) throw new BadRequestException({ statusCode: 400, message: 'Identificador no válido' });
    return this.lib.files({ folderId: folderId || undefined, q });
  }

  @Post('files')
  @AdminOnly()
  @UseInterceptors(UploadInterceptor)
  upload(@UploadedFile() file: Express.Multer.File | undefined, @Body() body: { name?: string; folderId?: string }, @CurrentUser() me: AuthUser) {
    if (!file) throw new BadRequestException({ statusCode: 400, message: 'Falta el archivo (campo «file»)' });
    const folderId = body?.folderId && body.folderId !== 'null' ? body.folderId : null;
    if (folderId && !/^[0-9a-f-]{36}$/i.test(folderId)) throw new BadRequestException({ statusCode: 400, message: 'Identificador no válido' });
    return this.lib.upload(file, { name: body?.name, folderId }, me.id);
  }

  @Patch('files/:id')
  @AdminOnly()
  updateFile(@Param('id', uuid) id: string, @Body(new ZodPipe(libraryFileUpdateSchema)) dto: { name?: string; folderId?: string | null }) {
    return this.lib.updateFile(id, dto);
  }

  @Delete('files/:id')
  @AdminOnly()
  async deleteFile(@Param('id', uuid) id: string) {
    await this.lib.deleteFile(id);
    return { ok: true };
  }
}
