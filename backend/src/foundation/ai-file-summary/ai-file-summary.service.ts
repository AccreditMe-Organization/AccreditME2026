import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import type { AiFileSummary, StoredFile } from '../../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogService } from '../../common/services/audit-log.service';
import { AiService } from '../ai/ai.service';
import { AiRefusalException } from '../ai/ai-refusal';
import { aiBalanceOf, openAiFeatures } from '../ai/ai-balance';
import { AI_FEATURES } from '../ai/ai.config';
import { StoredFileService } from '../file-storage/stored-file.service';
import { MIN_LETTERS, readFileText, summarizableKind, IFileText, COVERAGE_UNIT } from './extract/file-text';
import { PdfTextExtractor, PdfUnreadableError, PDF_READ_TIMEOUT_MS } from './extract/pdf-text-extractor';
import { ExtractionBusyError } from './extract/extraction-slots';
import { SummaryLanguage, acceptSummaryAnswer, parseSummaryAnswer, summaryPrompt, summarySystemPrompt, textBudget } from './summary-answer';
import { SummaryFileGoneError, SummaryRefusalException } from './summary-refusal';
import { IFileSummary, IFileSummaryView } from './interfaces/ai-file-summary.interface';

export const SUMMARY_FEATURE = 'document_summary';
/** The provider times out at 120 s and extraction at 30 s; a claim older than this is a crashed run. */
export const CLAIM_STALE_MS = 3 * 60 * 1000;
/** The gateway's input cap for this feature (ai.config.ts) — ours to keep (§14.2). */
export const SUMMARY_INPUT_CAP = AI_FEATURES.document_summary.inputTokenCap ?? 30_000;

/** The stored file, as the host's entitlement check returned it. */
export type SummarizableFile = Pick<
  StoredFile,
  'id' | 'organizationId' | 'provider' | 'bucket' | 'endpoint' | 'rootPath' | 'storageKey' | 'originalName' | 'mimeType' | 'sizeBytes' | 'deletedAt' | 'msSiteId' | 'msDriveId' | 'msItemId'
>;

type SaveOutcome = 'saved' | 'fileGone' | 'claimLost';

/**
 * ACC-193 — an AI summary of a stored file, ONE per language, made on request.
 *
 * The CALLER (a host: task evidence today) has already entitled the reader to
 * the file — exactly the viewer's check, and the same 404 (decision 1). This
 * service checks nothing about who is asking.
 *
 * make(), in order:
 *   1. A summarizable type (PDF, TXT, CSV) — else SUMMARY_NOT_AVAILABLE_FOR_TYPE.
 *   2. AI available for the organisation — else the gateway's AI_NOT_ENABLED.
 *   3. The claim, per file and language (§6). Taken → a saved summary is
 *      returned with no call; one in flight → AI_SUMMARY_IN_PROGRESS.
 *   4. The bytes, through the storage provider, and their text (§4): at most
 *      two PDF workers at once (§14.1), under the token budget (§14.2). Busy →
 *      SUMMARY_BUSY; unreadable → SUMMARY_FILE_UNREADABLE; no letters →
 *      SUMMARY_NO_TEXT. None of these reaches the model, so none is charged.
 *   5. The gateway, with accept(): an unusable answer is refunded (Q3).
 *   6. The save, under the StoredFile's row lock: a file deleted meanwhile
 *      saves nothing (§14.3).
 *   7. One audit row, no text (Q7).
 * Any failure before the save drops the claim. A cancel in the browser does
 * not reach here: the server finishes and saves (Q2).
 */
@Injectable()
export class AiFileSummaryService {
  private readonly logger = new Logger(AiFileSummaryService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ai: AiService,
    private readonly storedFiles: StoredFileService,
    private readonly pdf: PdfTextExtractor,
    private readonly auditLog: AuditLogService,
  ) {}

  /** The saved summary in `language`, and whether Summarize may be offered. Never calls the model. */
  async read(file: SummarizableFile, organizationId: string, language: SummaryLanguage, now: Date = new Date()): Promise<IFileSummaryView> {
    const [row, availability] = await Promise.all([
      this.prisma.aiFileSummary.findFirst({ where: { storedFileId: file.id, organizationId, language } }),
      summarizableKind(file.mimeType) ? this.availability(organizationId) : Promise.resolve({ available: false as const }),
    ]);
    return {
      available: availability.available,
      inProgress: !!row && !row.generatedAt && !!row.generatingSince && row.generatingSince.getTime() > now.getTime() - CLAIM_STALE_MS,
      summary: row?.generatedAt ? this.summaryOf(row, file) : null,
    };
  }

  async make(
    file: SummarizableFile,
    organizationId: string,
    actorId: string,
    language: SummaryLanguage,
    now: Date = new Date(),
  ): Promise<IFileSummaryView> {
    const kind = summarizableKind(file.mimeType);
    if (!kind) throw new SummaryRefusalException('SUMMARY_NOT_AVAILABLE_FOR_TYPE');
    const availability = await this.availability(organizationId);
    if (!availability.available) {
      throw new AiRefusalException('AI_NOT_ENABLED', { reason: availability.reason, feature: SUMMARY_FEATURE });
    }

    const rowId = await this.claim(file.id, organizationId, language, now);
    if (!rowId) {
      const existing = await this.prisma.aiFileSummary.findFirst({ where: { storedFileId: file.id, organizationId, language } });
      if (existing?.generatedAt) return this.read(file, organizationId, language, now);
      throw new SummaryRefusalException('AI_SUMMARY_IN_PROGRESS');
    }

    let outcome: SaveOutcome | null = null;
    try {
      const fileText = await this.readText(file, kind, language, now);
      const system = summarySystemPrompt(language);
      const prompt = summaryPrompt(file.originalName, kind, fileText);
      const result = await this.ai.run(
        SUMMARY_FEATURE,
        { organizationId, actorId },
        { system, prompt, description: `StoredFile ${file.id} summary · ${fileText.unitsRead} ${fileText.unit === 'text' ? 'bytes' : fileText.unit}`, accept: acceptSummaryAnswer },
      );
      if (result.inputTokens > SUMMARY_INPUT_CAP) {
        // §14.2: the estimate let too much through. Counts only; never fails the request.
        this.logger.warn(`StoredFile ${file.id} summary: real input ${result.inputTokens} tokens over the ${SUMMARY_INPUT_CAP} cap.`);
      }
      // accept() already refused anything this cannot read.
      const answer = parseSummaryAnswer(result.content)!;

      outcome = await this.saveIfFileStillThere(rowId, now, file, organizationId, {
        overview: answer.overview,
        keyPoints: answer.keyPoints,
        unitsRead: fileText.unitsRead,
        unitsTotal: fileText.unitsTotal,
        creditCost: result.creditCost,
        generatedById: actorId,
      });
      if (outcome === 'fileGone') {
        this.logger.log(`StoredFile ${file.id} in org ${organizationId} was deleted while its ${language} summary was made; nothing saved.`);
        throw new SummaryFileGoneError();
      }
      if (outcome === 'saved') {
        await this.auditLog.log({
          action: 'CREATE',
          objectType: 'AiFileSummary',
          objectId: rowId,
          actorId,
          tenantId: organizationId,
          // No text, ever: the summary lives in its own row (Q7, ACC-194 D5).
          metadata: {
            storedFileId: file.id,
            language,
            creditCost: result.creditCost,
            unitsRead: fileText.unitsRead,
            unitsTotal: fileText.unitsTotal,
            unit: fileText.unit,
          },
        });
      }
      return this.read(file, organizationId, language, now);
    } finally {
      if (outcome === null) await this.dropClaim(rowId, now);
    }
  }

  // -------------------------------------------------------------------------

  private async readText(file: SummarizableFile, kind: NonNullable<ReturnType<typeof summarizableKind>>, language: SummaryLanguage, now: Date): Promise<IFileText> {
    const bytes = await this.storedFiles.readBytes(file);
    const budget = textBudget(SUMMARY_INPUT_CAP, language, file.originalName, kind);
    let fileText: IFileText;
    try {
      fileText = await readFileText(kind, bytes, budget, this.pdf, now.getTime() + PDF_READ_TIMEOUT_MS);
    } catch (error) {
      if (error instanceof ExtractionBusyError) throw new SummaryRefusalException('SUMMARY_BUSY');
      if (error instanceof PdfUnreadableError) {
        this.logger.warn(`StoredFile ${file.id} could not be read for a summary (${error.reason}).`);
        throw new SummaryRefusalException('SUMMARY_FILE_UNREADABLE');
      }
      throw error;
    }
    if (fileText.letters < MIN_LETTERS) throw new SummaryRefusalException('SUMMARY_NO_TEXT');
    return fileText;
  }

  /**
   * One run per file and language, in ONE statement (§6): insert the row with
   * a claim, or take the claim on a row that has no summary yet and no live
   * claim. Null = taken: a saved summary, or one in flight.
   */
  private async claim(storedFileId: string, organizationId: string, language: SummaryLanguage, now: Date): Promise<string | null> {
    const staleBefore = new Date(now.getTime() - CLAIM_STALE_MS);
    const rows = await this.prisma.$queryRaw<{ id: string }[]>`
      INSERT INTO "AiFileSummary" ("id", "organizationId", "storedFileId", "language", "keyPoints", "creditCost", "generatingSince", "createdAt", "updatedAt")
      VALUES (${randomUUID()}, ${organizationId}, ${storedFileId}, ${language}, '[]'::jsonb, 0, ${now}, ${now}, ${now})
      ON CONFLICT ("storedFileId", "language") DO UPDATE SET "generatingSince" = ${now}, "updatedAt" = ${now}
      WHERE "AiFileSummary"."organizationId" = ${organizationId}
        AND "AiFileSummary"."generatedAt" IS NULL
        AND ("AiFileSummary"."generatingSince" IS NULL OR "AiFileSummary"."generatingSince" < ${staleBefore})
      RETURNING "id"`;
    return rows[0]?.id ?? null;
  }

  /** Our own claim only — never a later run's — and only a row with no summary in it. */
  private async dropClaim(rowId: string, claimedAt: Date): Promise<void> {
    try {
      await this.prisma.$executeRaw`
        DELETE FROM "AiFileSummary" WHERE "id" = ${rowId} AND "generatingSince" = ${claimedAt} AND "generatedAt" IS NULL`;
    } catch (error) {
      this.logger.error(`Could not drop the summary claim ${rowId}: ${(error as Error).message}`);
    }
  }

  /**
   * §14.3 — under the StoredFile's row lock, which the file's delete also
   * takes (it updates that row): a file deleted first saves nothing and drops
   * the claim; a save that gets the lock first is removed by the delete after.
   */
  private async saveIfFileStillThere(
    rowId: string,
    claimedAt: Date,
    file: SummarizableFile,
    organizationId: string,
    data: { overview: string; keyPoints: string[]; unitsRead: number; unitsTotal: number; creditCost: number; generatedById: string },
  ): Promise<SaveOutcome> {
    return this.prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<{ deletedAt: Date | null }[]>`
        SELECT "deletedAt" FROM "StoredFile" WHERE "id" = ${file.id} AND "organizationId" = ${organizationId} FOR UPDATE`;
      if (locked.length === 0 || locked[0]!.deletedAt) {
        await tx.aiFileSummary.deleteMany({ where: { id: rowId, organizationId, generatedAt: null } });
        return 'fileGone';
      }
      const updated = await tx.aiFileSummary.updateMany({
        where: { id: rowId, organizationId, generatingSince: claimedAt, generatedAt: null },
        data: { ...data, generatedAt: new Date(), generatingSince: null },
      });
      return updated.count === 1 ? 'saved' : 'claimLost';
    });
  }

  private async availability(organizationId: string): Promise<{ available: true } | { available: false; reason: 'NO_ALLOWANCE' | 'SWITCHED_OFF' | 'FEATURE_NOT_AVAILABLE' }> {
    const [org, features] = await Promise.all([
      this.prisma.organization.findFirst({
        where: { id: organizationId },
        select: {
          aiMonthlyCredits: true,
          aiPendingMonthlyCredits: true,
          aiCreditsUsed: true,
          aiCreditsPeriodStart: true,
          aiCreditsRenewsAt: true,
          bootstrappedAt: true,
          createdAt: true,
          settings: true,
        },
      }),
      openAiFeatures(this.prisma, organizationId),
    ]);
    if (!org || !features.some((f) => f.key === SUMMARY_FEATURE)) return { available: false, reason: 'FEATURE_NOT_AVAILABLE' };
    const balance = aiBalanceOf(org);
    if (!balance.enabled) return { available: false, reason: balance.monthlyCredits > 0 ? 'SWITCHED_OFF' : 'NO_ALLOWANCE' };
    return { available: true };
  }

  private summaryOf(row: AiFileSummary, file: SummarizableFile): IFileSummary {
    const kind = summarizableKind(file.mimeType);
    const partial = row.unitsRead !== null && row.unitsTotal !== null && row.unitsRead < row.unitsTotal;
    return {
      language: row.language === 'ar' ? 'ar' : 'en',
      overview: row.overview ?? '',
      keyPoints: Array.isArray(row.keyPoints) ? row.keyPoints.filter((p): p is string => typeof p === 'string') : [],
      madeAt: row.generatedAt!.toISOString(),
      coverage: partial && kind ? { unit: COVERAGE_UNIT[kind], read: row.unitsRead!, total: row.unitsTotal! } : null,
    };
  }
}
