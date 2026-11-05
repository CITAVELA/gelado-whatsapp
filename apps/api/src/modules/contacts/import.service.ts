import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException, OnModuleInit } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import {
  importOptionsSchema,
  type ImportJobDto, type ImportOptionsDto, type ImportPreviewDto, type ImportRowIssue, type ImportUploadResultDto,
} from '@gelado/shared';
import { PrismaService } from '../../common/prisma.service';
import { sha256 } from '../../common/tokens';
import { AuditService } from '../audit/audit.service';
import { JobsService, QUEUES } from '../jobs/jobs.service';
import { StorageService, buildObjectPath } from '../storage/storage.service';
import { ConsentService } from './consent.service';
import { SUPPRESSED_NOTE, SuppressionService } from './suppression.service';
import { csvCell } from './contacts.service';
import { MAX_IMPORT_BYTES, detectKind, parseFile, suggestMapping, type ParsedFile } from './import.parser';
import { analyzeRows, type Analysis, type PlanRow } from './import.rules';

const BATCH = 500;
const MAX_STORED_ISSUES = 20_000;
const LABEL_COLORS = ['#2457C5', '#C2333A', '#1E7A3D', '#B08A00', '#6B737C', '#7B3FA0', '#1F6F8B', '#9B5B12'];
const OPT_OUT_NOTE = 'Etiqueta NO PUBLICIDAD en la importación';

interface Existing { id: string; deletedAt: Date | null; consentStatus: string }

interface Resolved {
  analysis: Analysis;
  existing: Map<string, Existing>;
}

interface JobResult { optedOut: number; labelsCreated: number; failureMessage?: string | null }

@Injectable()
export class ImportService implements OnModuleInit {
  private readonly log = new Logger('Import');

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly jobs: JobsService,
    private readonly consent: ConsentService,
    private readonly audit: AuditService,
    private readonly suppression: SuppressionService,
  ) {}

  onModuleInit() {
    this.jobs.register<{ jobId: string }>(QUEUES.IMPORT_RUN, (d) => this.process(d.jobId), { batchSize: 1 });
  }

  // ── 1. Subir ──

  async upload(file: { originalname: string; buffer: Buffer; mimetype: string; size: number } | undefined, userId: string): Promise<ImportUploadResultDto> {
    if (!file?.buffer?.length) throw new BadRequestException({ statusCode: 400, message: 'Sube un archivo CSV o Excel (.xlsx)' });
    if (file.size > MAX_IMPORT_BYTES) throw new BadRequestException({ statusCode: 400, message: 'El archivo pesa más de 10 MB' });
    const fileName = Buffer.from(file.originalname, 'latin1').toString('utf8').replace(/[\\/]/g, '_').slice(0, 200);
    let parsed: ParsedFile;
    let kind: 'csv' | 'xlsx';
    try {
      kind = detectKind(fileName, file.buffer);
      parsed = await parseFile(fileName, file.buffer);
    } catch (e) {
      throw new BadRequestException({ statusCode: 400, message: (e as Error).message });
    }
    const storagePath = buildObjectPath(kind === 'xlsx' ? 'xlsx' : 'csv');
    const mimeType = kind === 'xlsx' ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' : 'text/csv';
    await this.storage.upload(storagePath, file.buffer, { contentType: mimeType });
    const media = await this.prisma.mediaFile.create({
      data: { storagePath, mimeType, sizeBytes: file.buffer.length, fileName, sha256: sha256(file.buffer), source: 'UPLOAD', createdById: userId },
    });
    const suggestedMapping = suggestMapping(parsed.columns);
    const job = await this.prisma.importJob.create({
      data: { fileName, mediaFileId: media.id, status: 'UPLOADED', totalRows: parsed.rows.length, mapping: suggestedMapping, createdById: userId },
    });
    const sampleRows = parsed.rows.filter((r) => Object.values(r).some((v) => v)).slice(0, 5);
    return { jobId: job.id, fileName, columns: parsed.columns, suggestedMapping, sampleRows, totalRows: parsed.rows.length };
  }

  // ── 2. Vista previa ──

  private async getJob(id: string) {
    const job = await this.prisma.importJob.findUnique({ where: { id } });
    if (!job) throw new NotFoundException({ statusCode: 404, message: 'Importación no encontrada' });
    return job;
  }

  private async load(job: { mediaFileId: string; fileName: string }): Promise<ParsedFile> {
    const media = await this.prisma.mediaFile.findUnique({ where: { id: job.mediaFileId } });
    if (!media) throw new NotFoundException({ statusCode: 404, message: 'El archivo de la importación ya no existe' });
    return parseFile(job.fileName, await this.storage.download(media.storagePath));
  }

  private validateOptions(opts: ImportOptionsDto, columns: string[]) {
    const unknown = Object.keys(opts.mapping).filter((c) => !columns.includes(c));
    if (unknown.length) throw new BadRequestException({ statusCode: 400, message: `Columnas que no están en el archivo: ${unknown.join(', ')}` });
    if (!Object.values(opts.mapping).includes('phone')) {
      throw new BadRequestException({ statusCode: 400, code: 'NO_PHONE_COLUMN', message: 'Indica qué columna contiene el teléfono móvil' });
    }
  }

  private async resolve(parsed: ParsedFile, opts: ImportOptionsDto): Promise<Resolved> {
    const analysis = analyzeRows(parsed.rows, opts);
    const existing = new Map<string, Existing>();
    const phones = analysis.plans.map((p) => p.phoneE164);
    for (let i = 0; i < phones.length; i += 5000) {
      const rows = await this.prisma.contact.findMany({
        where: { phoneE164: { in: phones.slice(i, i + 5000) } },
        select: { id: true, phoneE164: true, deletedAt: true, consentStatus: true },
      });
      for (const r of rows) existing.set(r.phoneE164, r);
    }
    return { analysis, existing };
  }

  async preview(jobId: string, opts: ImportOptionsDto): Promise<ImportPreviewDto> {
    const job = await this.getJob(jobId);
    if (job.status === 'RUNNING' || job.status === 'DONE') throw new ConflictException({ statusCode: 409, message: 'Esta importación ya se ha lanzado' });
    const parsed = await this.load(job);
    this.validateOptions(opts, parsed.columns);
    await this.checkAddLabels(opts.addLabelIds);
    const { analysis, existing } = await this.resolve(parsed, opts);

    let willCreate = 0;
    let willUpdate = 0;
    let skippedExisting = 0;
    let willOptOut = 0;
    const sample: ImportPreviewDto['sample'] = [];
    const suppressed = await this.suppression.suppressedAmong(analysis.plans.filter((p) => !existing.get(p.phoneE164)).map((p) => p.phoneE164));
    const extraIssues: ImportRowIssue[] = [];
    for (const p of analysis.plans) {
      const ex = existing.get(p.phoneE164);
      let action: 'create' | 'update' | 'skip';
      let reason: string | undefined;
      if (!ex || ex.deletedAt) action = 'create';
      else if (opts.onDuplicate === 'skip') {
        action = 'skip';
        reason = 'Ya existe un contacto con ese teléfono';
        skippedExisting++;
        extraIssues.push({ row: p.row, reason: 'Ya existe un contacto con ese teléfono (se omite)', value: p.phoneE164, kind: 'skipped' });
      } else action = 'update';
      if (action === 'create') willCreate++;
      else if (action === 'update') willUpdate++;
      // la baja NO PUBLICIDAD se aplica siempre (también a existentes omitidos) y los números suprimidos antes nacen de baja
      if ((p.optOut || suppressed.has(p.phoneE164)) && ex?.consentStatus !== 'REVOKED') willOptOut++;
      if (sample.length < 15) sample.push({ row: p.row, phoneE164: p.phoneE164, name: [p.data.firstName, p.data.lastName].filter(Boolean).join(' ') || p.data.company || '', labels: p.labels.concat(p.optOut ? ['(BAJA)'] : []), action, reason });
    }
    const all = [...analysis.issues, ...extraIssues].sort((a, b) => a.row - b.row);
    const problems = all.filter((i) => i.kind !== 'warning' || true);
    const willSkip = analysis.emptyRows + analysis.invalidPhone + analysis.duplicatesInFile + skippedExisting;
    await this.prisma.importJob.update({ where: { id: jobId }, data: { status: 'PREVIEWED', mapping: opts.mapping, options: opts as unknown as Prisma.InputJsonValue, totalRows: parsed.rows.length } });
    return {
      jobId, totalRows: parsed.rows.length, willCreate, willUpdate, willSkip, willOptOut,
      invalidPhone: analysis.invalidPhone, emptyRows: analysis.emptyRows, duplicatesInFile: analysis.duplicatesInFile, skippedExisting,
      totalIssues: problems.length, issues: problems.slice(0, 200), sample,
    };
  }

  private async checkAddLabels(ids: string[]) {
    if (!ids.length) return;
    const n = await this.prisma.label.count({ where: { id: { in: ids }, scope: 'CONTACT' } });
    if (n !== new Set(ids).size) throw new BadRequestException({ statusCode: 400, message: 'Alguna etiqueta a añadir no existe o no es de contacto' });
  }

  // ── 3. Lanzar ──

  async run(jobId: string, body: unknown): Promise<ImportJobDto> {
    const job = await this.getJob(jobId);
    if (job.status === 'RUNNING' || job.status === 'DONE') throw new ConflictException({ statusCode: 409, message: 'Esta importación ya se ha lanzado' });
    if (body && typeof body === 'object' && Object.keys(body as object).length) {
      const r = importOptionsSchema.safeParse(body);
      if (!r.success) throw new BadRequestException({ statusCode: 400, message: 'Opciones de importación no válidas', details: r.error.issues });
      const parsed = await this.load(job);
      this.validateOptions(r.data, parsed.columns);
      await this.checkAddLabels(r.data.addLabelIds);
      await this.prisma.importJob.update({ where: { id: jobId }, data: { mapping: r.data.mapping, options: r.data as unknown as Prisma.InputJsonValue } });
    } else if (!job.options) {
      throw new BadRequestException({ statusCode: 400, message: 'Primero revisa la vista previa con las columnas y las reglas' });
    }
    await this.prisma.importJob.update({ where: { id: jobId }, data: { status: 'RUNNING', processedRows: 0, created: 0, updated: 0, skipped: 0, errors: Prisma.JsonNull, finishedAt: null } });
    await this.jobs.send(QUEUES.IMPORT_RUN, { jobId }, { retryLimit: 0 });
    return this.getDto(jobId);
  }

  // ── 4. Proceso en segundo plano ──

  async process(jobId: string): Promise<void> {
    const job = await this.getJob(jobId);
    if (job.status !== 'RUNNING') return;
    const t0 = Date.now();
    try {
      const opts = importOptionsSchema.parse(job.options);
      const parsed = await this.load(job);
      const { analysis, existing } = await this.resolve(parsed, opts);
      const result = await this.apply(job.id, job.createdById, analysis, existing, opts, parsed.rows.length);
      await this.audit.log({
        userId: job.createdById, action: 'import_contacts', entityType: 'ImportJob', entityId: job.id,
        data: {
          fileName: job.fileName, totalRows: parsed.rows.length,
          options: { defaultCountry: opts.defaultCountry, onDuplicate: opts.onDuplicate, optOutLabelValues: opts.optOutLabelValues, initialConsent: opts.initialConsent, createMissingLabels: opts.createMissingLabels, addLabelIds: opts.addLabelIds, mapping: opts.mapping },
          created: result.created, updated: result.updated, skipped: result.skipped, optedOut: result.optedOut, ms: Date.now() - t0 },
      });
    } catch (e) {
      this.log.error(`Importación ${jobId} falló: ${(e as Error)?.stack ?? e}`);
      const prev = (job.options ?? {}) as any;
      await this.prisma.importJob.update({
        where: { id: jobId },
        data: { status: 'FAILED', finishedAt: new Date(), options: { ...prev, _result: { optedOut: 0, labelsCreated: 0, failureMessage: (e as Error).message } } },
      });
    }
  }

  private async apply(jobId: string, userId: string, analysis: Analysis, existing: Map<string, Existing>, opts: ImportOptionsDto, totalRows: number) {
    // Etiquetas: las existentes por nombre y las que falten (en mayúsculas)
    const names = [...new Set(analysis.plans.flatMap((p) => p.labels))];
    const labelIds = new Map<string, string>();
    let labelsCreated = 0;
    const issues: ImportRowIssue[] = [...analysis.issues];
    if (names.length) {
      for (const l of await this.prisma.label.findMany({ where: { scope: 'CONTACT', name: { in: names } } })) labelIds.set(l.name, l.id);
      const missing = names.filter((n) => !labelIds.has(n));
      if (missing.length && opts.createMissingLabels) {
        const base = await this.prisma.label.count({ where: { scope: 'CONTACT' } });
        const r = await this.prisma.label.createMany({
          data: missing.map((name, i) => ({ name, scope: 'CONTACT' as const, color: LABEL_COLORS[(base + i) % LABEL_COLORS.length]!, sortOrder: base + i + 1 })),
          skipDuplicates: true,
        });
        labelsCreated = r.count;
        for (const l of await this.prisma.label.findMany({ where: { scope: 'CONTACT', name: { in: missing } } })) labelIds.set(l.name, l.id);
      }
    }
    const warnedLabels = new Set<string>();
    const labelsFor = (p: PlanRow): string[] => {
      const ids = new Set<string>(opts.addLabelIds);
      for (const n of p.labels) {
        const id = labelIds.get(n);
        if (id) ids.add(id);
        else if (!warnedLabels.has(n)) {
          warnedLabels.add(n);
          issues.push({ row: p.row, reason: `Aviso: la etiqueta ${n} no existe (no se crea)`, value: n, kind: 'warning' });
        }
      }
      return [...ids];
    };

    let created = 0;
    let updated = 0;
    let optedOut = 0;
    // filas ya resueltas antes de empezar: vacías, inválidas y duplicadas
    let processed = totalRows - analysis.plans.reduce((n, p) => n + p.rows.length, 0);
    await this.prisma.importJob.update({ where: { id: jobId }, data: { processedRows: processed } });

    // «Omitir existentes» no toca los datos, pero una baja (NO PUBLICIDAD) del archivo se aplica siempre: nunca se pierde
    const skipExisting = async (p: PlanRow, ex: Existing) => {
      issues.push({ row: p.row, reason: 'Ya existe un contacto con ese teléfono (se omite)', value: p.phoneE164, kind: 'skipped' });
      if (p.optOut && ex.consentStatus !== 'REVOKED') {
        const r = await this.consent.setConsent(ex.id, 'REVOKED', 'LEGACY_LABEL', { userId, note: OPT_OUT_NOTE });
        if (r.changed) {
          optedOut++;
          issues.push({ row: p.row, reason: 'Aviso: se omiten los datos, pero se aplica la baja NO PUBLICIDAD', value: p.phoneE164, kind: 'warning' });
        }
      }
    };

    const plans = analysis.plans;
    for (let i = 0; i < plans.length; i += BATCH) {
      const batch = plans.slice(i, i + BATCH);
      const news: PlanRow[] = [];
      const revived: Array<{ p: PlanRow; ex: Existing }> = [];
      const updatedRows: Array<{ p: PlanRow; ex: Existing }> = [];
      for (const p of batch) {
        const ex = existing.get(p.phoneE164);
        if (!ex) news.push(p);
        else if (ex.deletedAt) revived.push({ p, ex });
        else if (opts.onDuplicate === 'skip') await skipExisting(p, ex);
        else updatedRows.push({ p, ex });
      }

      // números suprimidos antes (borrado físico): nacen dados de baja
      const suppressed = await this.suppression.suppressedAmong(news.map((p) => p.phoneE164));
      try {
        await this.createBatch(news, userId, opts, labelsFor, suppressed);
        created += news.length;
        optedOut += news.filter((p) => p.optOut || suppressed.has(p.phoneE164)).length;
      } catch {
        // carrera con otra alta (p. ej. un entrante): fila a fila; si el teléfono ya existe, se aplica la ruta de actualización
        for (const p of news) {
          try {
            await this.createBatch([p], userId, opts, labelsFor, suppressed);
            created++;
            if (p.optOut || suppressed.has(p.phoneE164)) optedOut++;
          } catch (err) {
            const ex = await this.findByPhoneOrWaId(p);
            if (!ex) {
              issues.push({ row: p.row, reason: `No se pudo crear el contacto: ${(err as Error).message.slice(0, 120)}`, value: p.phoneE164, kind: 'skipped' });
            } else if (ex.deletedAt) revived.push({ p, ex });
            else if (opts.onDuplicate === 'skip') await skipExisting(p, ex);
            else updatedRows.push({ p, ex });
          }
        }
      }

      for (const { p, ex } of revived) {
        await this.reviveOne(p, ex, userId, opts, labelsFor(p));
        created++;
        if (p.optOut) optedOut++;
      }
      if (updatedRows.length) {
        await this.prisma.$transaction(updatedRows.map(({ p, ex }) => this.prisma.contact.update({ where: { id: ex.id }, data: p.data })));
        const links = updatedRows.flatMap(({ p, ex }) => labelsFor(p).map((labelId) => ({ contactId: ex.id, labelId })));
        if (links.length) await this.prisma.contactLabel.createMany({ data: links, skipDuplicates: true });
        for (const { p, ex } of updatedRows) {
          updated++;
          if (p.optOut && ex.consentStatus !== 'REVOKED') {
            await this.consent.setConsent(ex.id, 'REVOKED', 'LEGACY_LABEL', { userId, note: OPT_OUT_NOTE });
            optedOut++;
          }
        }
      }
      processed += batch.reduce((n, p) => n + p.rows.length, 0);
      await this.prisma.importJob.update({ where: { id: jobId }, data: { processedRows: Math.min(processed, totalRows), created, updated } });
    }

    issues.sort((a, b) => a.row - b.row);
    const skipped = totalRows - created - updated;
    const result: JobResult = { optedOut, labelsCreated };
    const prev = (await this.getJob(jobId)).options as any;
    await this.prisma.importJob.update({
      where: { id: jobId },
      data: {
        status: 'DONE', processedRows: totalRows, created, updated, skipped, finishedAt: new Date(),
        errors: issues.slice(0, MAX_STORED_ISSUES) as unknown as Prisma.InputJsonValue,
        options: { ...prev, _result: { ...result, errorCount: issues.length } },
      },
    });
    return { created, updated, skipped, optedOut };
  }

  /** Alta en bloque: contactos, etiquetas y ConsentEvent (regla 5: cada estado inicial no desconocido deja su evento). */
  private async createBatch(plans: PlanRow[], userId: string, opts: ImportOptionsDto, labelsFor: (p: PlanRow) => string[], suppressed: Set<string>) {
    if (!plans.length) return;
    const now = new Date();
    const ids = plans.map(() => randomUUID());
    const status = (p: PlanRow) => (p.optOut || suppressed.has(p.phoneE164) ? 'REVOKED' : opts.initialConsent);
    await this.prisma.$transaction(async (tx) => {
      const r = await tx.contact.createMany({
        data: plans.map((p, k) => ({
          id: ids[k]!, phoneE164: p.phoneE164, waId: p.waId, ...p.data,
          consentStatus: status(p), consentAt: status(p) === 'UNKNOWN' ? null : now,
        })),
      });
      if (r.count !== plans.length) throw new Error('Contactos duplicados en el lote');
      const links = plans.flatMap((p, k) => labelsFor(p).map((labelId) => ({ contactId: ids[k]!, labelId })));
      if (links.length) await tx.contactLabel.createMany({ data: links, skipDuplicates: true });
      const events = plans.flatMap((p, k) =>
        status(p) === 'UNKNOWN'
          ? []
          : [
              p.optOut
                ? { contactId: ids[k]!, status: 'REVOKED' as const, source: 'LEGACY_LABEL' as const, note: OPT_OUT_NOTE, userId }
                : suppressed.has(p.phoneE164)
                  ? { contactId: ids[k]!, status: 'REVOKED' as const, source: 'MANUAL' as const, note: SUPPRESSED_NOTE, userId }
                  : { contactId: ids[k]!, status: status(p) as 'GRANTED', source: 'IMPORT' as const, note: 'Consentimiento inicial de la importación', userId },
            ],
      );
      if (events.length) await tx.consentEvent.createMany({ data: events });
    }, { timeout: 60_000 });
  }

  /** Relee el contacto que ganó la carrera (por teléfono o wa_id, ambos únicos). */
  private findByPhoneOrWaId(p: PlanRow): Promise<Existing | null> {
    return this.prisma.contact.findFirst({
      where: { OR: [{ phoneE164: p.phoneE164 }, { waId: p.waId }] },
      select: { id: true, deletedAt: true, consentStatus: true },
    });
  }

  /** Contacto borrado antes que vuelve en el archivo: se reactiva con los datos del archivo y conserva su consentimiento. */
  private async reviveOne(p: PlanRow, ex: Existing, userId: string, opts: ImportOptionsDto, labelIds: string[]) {
    await this.prisma.$transaction(async (tx) => {
      await tx.contactLabel.deleteMany({ where: { contactId: ex.id } });
      await tx.contact.update({
        where: { id: ex.id },
        data: { firstName: null, lastName: null, email: null, company: null, customerCode: null, taxId: null, landline: null, notes: null, ...p.data, deletedAt: null },
      });
      if (labelIds.length) await tx.contactLabel.createMany({ data: labelIds.map((labelId) => ({ contactId: ex.id, labelId })), skipDuplicates: true });
    });
    if (p.optOut && ex.consentStatus !== 'REVOKED') await this.consent.setConsent(ex.id, 'REVOKED', 'LEGACY_LABEL', { userId, note: OPT_OUT_NOTE });
  }

  // ── 5. Progreso e informe ──

  async getDto(jobId: string): Promise<ImportJobDto> {
    const j = await this.getJob(jobId);
    const errors = Array.isArray(j.errors) ? (j.errors as unknown as ImportRowIssue[]) : [];
    const res = ((j.options as any)?._result ?? {}) as JobResult & { errorCount?: number };
    return {
      id: j.id, fileName: j.fileName, status: j.status as ImportJobDto['status'], totalRows: j.totalRows, processedRows: j.processedRows,
      created: j.created, updated: j.updated, skipped: j.skipped, errors: errors.slice(0, 500), errorCount: res.errorCount ?? errors.length,
      optedOut: res.optedOut ?? 0, labelsCreated: res.labelsCreated ?? 0, failureMessage: res.failureMessage ?? null,
      createdAt: j.createdAt.toISOString(), finishedAt: j.finishedAt?.toISOString() ?? null,
    };
  }

  async reportCsv(jobId: string): Promise<{ csv: string; fileName: string }> {
    const j = await this.getJob(jobId);
    const errors = Array.isArray(j.errors) ? (j.errors as unknown as ImportRowIssue[]) : [];
    const kindEs = { skipped: 'Descartada', merged: 'Unida', warning: 'Aviso' } as const;
    const lines = [['Fila', 'Resultado', 'Motivo', 'Valor'].join(';')];
    for (const e of errors) lines.push([e.row, kindEs[e.kind ?? 'skipped'], e.reason, e.value ?? ''].map(csvCell).join(';'));
    lines.push('');
    lines.push(['Resumen', `Filas: ${j.totalRows}`, `Creados: ${j.created}`, `Actualizados: ${j.updated}`, `Omitidos: ${j.skipped}`].map(csvCell).join(';'));
    return { csv: '﻿' + lines.join('\r\n') + '\r\n', fileName: `informe-importacion-${j.fileName.replace(/\.[^.]+$/, '').replace(/[^\w.-]+/g, '_')}.csv` };
  }
}
