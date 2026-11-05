import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { importOptionsSchema, type ImportOptionsDto } from '@gelado/shared';
import { CurrentUser, type AuthUser } from '../../common/decorators';
import { ZodPipe } from '../../common/zod.pipe';
import { MAX_IMPORT_BYTES } from './import.parser';
import { ImportService } from './import.service';

/** Se registra antes que ContactsController para que /import no choque con /:id. */
@Controller('api/contacts/import')
export class ImportController {
  constructor(private readonly imports: ImportService) {}

  @Post()
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_IMPORT_BYTES, files: 1 } }))
  upload(@UploadedFile() file: { originalname: string; buffer: Buffer; mimetype: string; size: number } | undefined, @CurrentUser() me: AuthUser) {
    return this.imports.upload(file, me.id);
  }

  @Post(':jobId/preview')
  preview(@Param('jobId', ParseUUIDPipe) jobId: string, @Body(new ZodPipe(importOptionsSchema)) opts: ImportOptionsDto) {
    return this.imports.preview(jobId, opts);
  }

  @Post(':jobId/run')
  run(@Param('jobId', ParseUUIDPipe) jobId: string, @Body() body: unknown) {
    return this.imports.run(jobId, body);
  }

  @Get(':jobId')
  get(@Param('jobId', ParseUUIDPipe) jobId: string) {
    return this.imports.getDto(jobId);
  }

  @Get(':jobId/report.csv')
  async report(@Param('jobId', ParseUUIDPipe) jobId: string, @Res() res: Response) {
    const { csv, fileName } = await this.imports.reportCsv(jobId);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    res.send(csv);
  }
}
