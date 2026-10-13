import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { AuditLogService } from '../../common/services/audit-log.service';
import { AiModule } from '../ai/ai.module';
import { FileStorageModule } from '../file-storage/file-storage.module';
import { AiFileSummaryService } from './ai-file-summary.service';
import { PdfTextExtractor } from './extract/pdf-text-extractor';

/**
 * ACC-193 — AI summaries of stored files. No controller of its own: a HOST
 * that already entitles a reader to a file (task evidence today, meetings and
 * documents later) exposes the summary routes and calls AiFileSummaryService.
 * PdfTextExtractor is a singleton here, so its two worker slots (§14.1) are
 * per process.
 */
@Module({
  imports: [PrismaModule, AiModule, FileStorageModule],
  providers: [AiFileSummaryService, PdfTextExtractor, AuditLogService],
  exports: [AiFileSummaryService],
})
export class AiFileSummaryModule {}
