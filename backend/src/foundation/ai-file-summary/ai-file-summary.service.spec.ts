import { Logger } from '@nestjs/common';
import { AiFileSummaryService, SummarizableFile, SUMMARY_INPUT_CAP } from './ai-file-summary.service';
import { SummaryFileGoneError, SummaryRefusalException } from './summary-refusal';
import { PdfTextExtractor, PdfUnreadableError } from './extract/pdf-text-extractor';
import { ExtractionBusyError } from './extract/extraction-slots';
import { CLOSE_TEXT, OPEN_TEXT } from './summary-answer';
import { PrismaService } from '../../prisma/prisma.service';
import { AiService } from '../ai/ai.service';
import { AiRefusalException } from '../ai/ai-refusal';
import { StoredFileService } from '../file-storage/stored-file.service';
import { AuditLogService } from '../../common/services/audit-log.service';
import { itEnforcesTenantIsolation } from '../../common/testing/tenant-isolation';

const ORG = 'org-a';
const ACTOR = 'user-1';
const NOW = new Date('2026-10-13T09:00:00Z');
const FILE_TEXT = 'The infection control policy requires hand hygiene before and after every patient contact.';
const SECRET = 'CONFIDENTIAL-PATIENT-NAME-4471';

const TXT_FILE: SummarizableFile = {
  id: 'file-1',
  organizationId: ORG,
  provider: 'S3',
  bucket: 'b',
  endpoint: null,
  rootPath: null,
  storageKey: 'org-a/tasks/t/x-policy.txt',
  originalName: 'policy.txt',
  mimeType: 'text/plain',
  sizeBytes: 200,
  deletedAt: null,
  msSiteId: null,
  msDriveId: null,
  msItemId: null,
};
const PDF_FILE: SummarizableFile = { ...TXT_FILE, id: 'file-2', originalName: 'policy.pdf', mimeType: 'application/pdf' };
const PNG_FILE: SummarizableFile = { ...TXT_FILE, id: 'file-3', originalName: 'photo.png', mimeType: 'image/png' };

const AI_ON = {
  aiMonthlyCredits: 2000,
  aiPendingMonthlyCredits: null,
  aiCreditsUsed: 0,
  aiCreditsPeriodStart: new Date('2026-09-21T04:39:49Z'),
  aiCreditsRenewsAt: new Date('2099-10-21T00:00:00Z'),
  bootstrappedAt: new Date('2026-09-21T04:39:49Z'),
  createdAt: new Date('2026-09-21T04:38:14Z'),
  settings: null,
};
const OPEN = [{ featureKey: 'document_summary', creditCost: 15, restricted: false, allowedOrganizationIds: [] }];
const ANSWER = '{"overview": "The policy sets hand hygiene rules.", "keyPoints": ["Before and after every contact"]}';

const savedRow = (over: Record<string, unknown> = {}) => ({
  id: 'sum-1',
  organizationId: ORG,
  storedFileId: 'file-1',
  language: 'en',
  overview: 'The policy sets hand hygiene rules.',
  keyPoints: ['Before and after every contact'],
  unitsRead: 200,
  unitsTotal: 200,
  creditCost: 15,
  generatedById: ACTOR,
  generatedAt: new Date('2026-10-09T08:00:00Z'),
  generatingSince: null,
  ...over,
});

function argsOf(fn: jest.Mock, call = 0): unknown[] {
  return (fn.mock.calls as unknown[][])[call] ?? [];
}

function setup() {
  const tx = {
    $queryRaw: jest.fn().mockResolvedValue([{ deletedAt: null }]),
    aiFileSummary: { updateMany: jest.fn().mockResolvedValue({ count: 1 }), deleteMany: jest.fn().mockResolvedValue({ count: 1 }) },
  };
  const prisma = {
    aiFileSummary: { findFirst: jest.fn().mockResolvedValue(null) },
    organization: { findFirst: jest.fn().mockResolvedValue(AI_ON) },
    aiFeatureCost: { findMany: jest.fn().mockResolvedValue(OPEN) },
    $queryRaw: jest.fn().mockResolvedValue([{ id: 'sum-1' }]),
    $executeRaw: jest.fn().mockResolvedValue(1),
    $transaction: jest.fn((cb: (t: typeof tx) => unknown) => cb(tx)),
  };
  const ai = {
    run: jest.fn().mockResolvedValue({ content: ANSWER, creditCost: 15, inputTokens: 300, outputTokens: 120, truncated: false }),
  };
  const storedFiles = { readBytes: jest.fn().mockResolvedValue(Buffer.from(`${FILE_TEXT} ${SECRET}`)) };
  const pdf = { read: jest.fn() };
  const auditLog = { log: jest.fn().mockResolvedValue(undefined) };
  const service = new AiFileSummaryService(
    prisma as unknown as PrismaService,
    ai as unknown as AiService,
    storedFiles as unknown as StoredFileService,
    pdf as unknown as PdfTextExtractor,
    auditLog as unknown as AuditLogService,
  );
  return { service, prisma, tx, ai, storedFiles, pdf, auditLog };
}

async function refusalOf(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (e) {
    return e;
  }
  throw new Error('expected a refusal');
}

describe('AiFileSummaryService.read (ACC-193) — never calls the model', () => {
  it('a saved summary in the reader\'s language, with its date; the whole file read → no coverage line', async () => {
    const { service, prisma, ai } = setup();
    prisma.aiFileSummary.findFirst.mockResolvedValue(savedRow());
    const view = await service.read(TXT_FILE, ORG, 'en', NOW);
    expect(view).toEqual({
      available: true,
      inProgress: false,
      summary: {
        language: 'en',
        overview: 'The policy sets hand hygiene rules.',
        keyPoints: ['Before and after every contact'],
        madeAt: '2026-10-09T08:00:00.000Z',
        coverage: null,
      },
    });
    expect(prisma.aiFileSummary.findFirst).toHaveBeenCalledWith({ where: { storedFileId: 'file-1', organizationId: ORG, language: 'en' } });
    expect(ai.run).not.toHaveBeenCalled();
  });

  it('a partial read says how much: "From the first 100 pages of 412."', async () => {
    const { service, prisma } = setup();
    prisma.aiFileSummary.findFirst.mockResolvedValue(savedRow({ storedFileId: 'file-2', unitsRead: 100, unitsTotal: 412 }));
    expect((await service.read(PDF_FILE, ORG, 'en', NOW)).summary?.coverage).toEqual({ unit: 'pages', read: 100, total: 412 });
  });

  it('a live claim with no summary yet is "in progress"; a stale one is not', async () => {
    const { service, prisma } = setup();
    prisma.aiFileSummary.findFirst.mockResolvedValue(savedRow({ generatedAt: null, overview: null, generatingSince: new Date(NOW.getTime() - 60_000) }));
    expect(await service.read(TXT_FILE, ORG, 'ar', NOW)).toEqual({ available: true, inProgress: true, summary: null });
    prisma.aiFileSummary.findFirst.mockResolvedValue(savedRow({ generatedAt: null, overview: null, generatingSince: new Date(NOW.getTime() - 10 * 60_000) }));
    expect((await service.read(TXT_FILE, ORG, 'ar', NOW)).inProgress).toBe(false);
  });

  it('not available: an image (decision 3), no allocation, or the feature closed — a saved summary still shows (Q1)', async () => {
    const { service, prisma } = setup();
    expect((await service.read(PNG_FILE, ORG, 'en', NOW)).available).toBe(false);
    prisma.organization.findFirst.mockResolvedValue({ ...AI_ON, aiMonthlyCredits: 0 });
    prisma.aiFileSummary.findFirst.mockResolvedValue(savedRow());
    const off = await service.read(TXT_FILE, ORG, 'en', NOW);
    expect(off.available).toBe(false);
    expect(off.summary?.overview).toBe('The policy sets hand hygiene rules.');
    prisma.organization.findFirst.mockResolvedValue(AI_ON);
    prisma.aiFeatureCost.findMany.mockResolvedValue([]);
    expect((await service.read(TXT_FILE, ORG, 'en', NOW)).available).toBe(false);
  });
});

describe('AiFileSummaryService.make (ACC-193)', () => {
  it('reads the file, calls document_summary with accept() and a counts-only description, saves, audits with no text', async () => {
    const { service, ai, tx, auditLog, prisma } = setup();
    prisma.aiFileSummary.findFirst.mockResolvedValue(savedRow({ language: 'ar' })); // the read after the save
    const view = await service.make(TXT_FILE, ORG, ACTOR, 'ar', NOW);

    const [feature, context, request] = argsOf(ai.run) as [string, unknown, { system: string; prompt: string; description: string; accept: unknown }];
    expect(feature).toBe('document_summary');
    expect(context).toEqual({ organizationId: ORG, actorId: ACTOR });
    expect(request.system).toContain('Write ONLY in Arabic');
    expect(request.prompt).toContain(`${OPEN_TEXT}\n${FILE_TEXT} ${SECRET}\n${CLOSE_TEXT}`);
    expect(request.description).toMatch(/^StoredFile file-1 summary · \d+ bytes$/);
    expect(request.description).not.toContain(SECRET);
    expect(typeof request.accept).toBe('function');

    expect(tx.aiFileSummary.updateMany).toHaveBeenCalledWith({
      where: { id: 'sum-1', organizationId: ORG, generatingSince: NOW, generatedAt: null },
      data: expect.objectContaining({
        overview: 'The policy sets hand hygiene rules.',
        keyPoints: ['Before and after every contact'],
        creditCost: 15,
        generatedById: ACTOR,
        generatingSince: null,
      }) as unknown,
    });
    const audit = argsOf(auditLog.log)[0] as Record<string, unknown>;
    expect(audit).toEqual(expect.objectContaining({ action: 'CREATE', objectType: 'AiFileSummary', objectId: 'sum-1', actorId: ACTOR, tenantId: ORG }));
    expect(JSON.stringify(audit)).not.toContain('hand hygiene');
    expect(JSON.stringify(audit)).not.toContain(SECRET);
    expect(view.summary?.language).toBe('ar');
  });

  it('decision 3: an image is refused before anything — no claim, no read, no call', async () => {
    const { service, prisma, ai, storedFiles } = setup();
    const e = await refusalOf(service.make(PNG_FILE, ORG, ACTOR, 'en', NOW));
    expect((e as SummaryRefusalException).code).toBe('SUMMARY_NOT_AVAILABLE_FOR_TYPE');
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
    expect(storedFiles.readBytes).not.toHaveBeenCalled();
    expect(ai.run).not.toHaveBeenCalled();
  });

  it('AI not available → the gateway\'s AI_NOT_ENABLED with its reason, before any claim', async () => {
    const { service, prisma } = setup();
    prisma.organization.findFirst.mockResolvedValue({ ...AI_ON, aiMonthlyCredits: 0 });
    const e = await refusalOf(service.make(TXT_FILE, ORG, ACTOR, 'en', NOW));
    expect((e as AiRefusalException).code).toBe('AI_NOT_ENABLED');
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });

  it('a summary already saved in this language is returned with no read and no call (two people, seconds apart)', async () => {
    const { service, prisma, ai, storedFiles } = setup();
    prisma.$queryRaw.mockResolvedValue([]);
    prisma.aiFileSummary.findFirst.mockResolvedValue(savedRow());
    const view = await service.make(TXT_FILE, ORG, ACTOR, 'en', NOW);
    expect(view.summary?.overview).toBe('The policy sets hand hygiene rules.');
    expect(storedFiles.readBytes).not.toHaveBeenCalled();
    expect(ai.run).not.toHaveBeenCalled();
  });

  it('one being made → 409 AI_SUMMARY_IN_PROGRESS, nothing read or called', async () => {
    const { service, prisma, ai } = setup();
    prisma.$queryRaw.mockResolvedValue([]);
    prisma.aiFileSummary.findFirst.mockResolvedValue(savedRow({ generatedAt: null, overview: null, generatingSince: NOW }));
    const e = await refusalOf(service.make(TXT_FILE, ORG, ACTOR, 'en', NOW));
    expect((e as SummaryRefusalException).code).toBe('AI_SUMMARY_IN_PROGRESS');
    expect((e as SummaryRefusalException).getStatus()).toBe(409);
    expect(ai.run).not.toHaveBeenCalled();
  });

  it('decision 6: no readable text → SUMMARY_NO_TEXT, no call, and the claim is dropped', async () => {
    const { service, storedFiles, ai, prisma } = setup();
    storedFiles.readBytes.mockResolvedValue(Buffer.from('1,2,3 4 5 6 7 8 9 10'));
    const e = await refusalOf(service.make(TXT_FILE, ORG, ACTOR, 'en', NOW));
    expect((e as SummaryRefusalException).code).toBe('SUMMARY_NO_TEXT');
    expect(ai.run).not.toHaveBeenCalled();
    expect(prisma.$executeRaw).toHaveBeenCalledTimes(1);
    expect((argsOf(prisma.$executeRaw)[0] as TemplateStringsArray).join('?')).toContain('DELETE FROM "AiFileSummary" WHERE "id" = ? AND "generatingSince" = ? AND "generatedAt" IS NULL');
  });

  it('§14.1: no PDF slot in time → SUMMARY_BUSY (503), no call, claim dropped', async () => {
    const { service, pdf, ai, prisma } = setup();
    pdf.read.mockRejectedValue(new ExtractionBusyError());
    const e = await refusalOf(service.make(PDF_FILE, ORG, ACTOR, 'en', NOW));
    expect((e as SummaryRefusalException).code).toBe('SUMMARY_BUSY');
    expect((e as SummaryRefusalException).getStatus()).toBe(503);
    expect(ai.run).not.toHaveBeenCalled();
    expect(prisma.$executeRaw).toHaveBeenCalledTimes(1);
  });

  it('a PDF that cannot be read (corrupt, protected, timed out) → SUMMARY_FILE_UNREADABLE, no call', async () => {
    const { service, pdf, ai } = setup();
    pdf.read.mockRejectedValue(new PdfUnreadableError('PasswordException'));
    const e = await refusalOf(service.make(PDF_FILE, ORG, ACTOR, 'en', NOW));
    expect((e as SummaryRefusalException).code).toBe('SUMMARY_FILE_UNREADABLE');
    expect(ai.run).not.toHaveBeenCalled();
  });

  it('§14.1: the PDF read gets ONE deadline, 30 s from the press', async () => {
    const { service, pdf } = setup();
    pdf.read.mockImplementation((_b: unknown, opts: { onPage: (n: number, t: string) => boolean }) => {
      opts.onPage(1, FILE_TEXT);
      return Promise.resolve({ numPages: 1 });
    });
    await service.make(PDF_FILE, ORG, ACTOR, 'en', NOW);
    expect((argsOf(pdf.read)[1] as { deadline: number }).deadline).toBe(NOW.getTime() + 30_000);
  });

  it.each([
    [1, '1 page'],
    [2, '2 pages'],
  ])('ACC-224: a %i-page PDF\'s log description says "%s"', async (pages, words) => {
    const { service, pdf, ai } = setup();
    pdf.read.mockImplementation((_b: unknown, opts: { onPage: (n: number, t: string) => boolean }) => {
      for (let n = 1; n <= pages; n++) opts.onPage(n, FILE_TEXT);
      return Promise.resolve({ numPages: pages });
    });
    await service.make(PDF_FILE, ORG, ACTOR, 'en', NOW);
    expect((argsOf(ai.run)[2] as { description: string }).description).toBe(`StoredFile file-2 summary · ${words}`);
  });

  it('a gateway refusal passes through unchanged, and the claim is dropped', async () => {
    const { service, ai, prisma, tx } = setup();
    ai.run.mockRejectedValue(new AiRefusalException('AI_CREDITS_EXHAUSTED', { creditCost: 15, creditsRemaining: 2, renewsAt: '2026-10-21T00:00:00.000Z' }));
    const e = await refusalOf(service.make(TXT_FILE, ORG, ACTOR, 'en', NOW));
    expect((e as AiRefusalException).code).toBe('AI_CREDITS_EXHAUSTED');
    expect(prisma.$executeRaw).toHaveBeenCalledTimes(1);
    expect(tx.aiFileSummary.updateMany).not.toHaveBeenCalled();
  });

  it('§14.3: a file deleted while its summary was made saves NOTHING, drops the claim in the same transaction, writes no audit row', async () => {
    const { service, tx, auditLog } = setup();
    tx.$queryRaw.mockResolvedValue([{ deletedAt: new Date('2026-10-13T09:00:05Z') }]);
    const e = await refusalOf(service.make(TXT_FILE, ORG, ACTOR, 'en', NOW));
    expect(e).toBeInstanceOf(SummaryFileGoneError);
    expect((argsOf(tx.$queryRaw)[0] as TemplateStringsArray).join('?')).toContain('SELECT "deletedAt" FROM "StoredFile" WHERE "id" = ? AND "organizationId" = ? FOR UPDATE');
    expect(tx.aiFileSummary.updateMany).not.toHaveBeenCalled();
    expect(tx.aiFileSummary.deleteMany).toHaveBeenCalledWith({ where: { id: 'sum-1', organizationId: ORG, generatedAt: null } });
    expect(auditLog.log).not.toHaveBeenCalled();
  });

  it('a claim taken over meanwhile (stale) saves nothing of ours and writes no audit row', async () => {
    const { service, tx, auditLog } = setup();
    tx.aiFileSummary.updateMany.mockResolvedValue({ count: 0 });
    await service.make(TXT_FILE, ORG, ACTOR, 'en', NOW);
    expect(auditLog.log).not.toHaveBeenCalled();
  });

  it('§14.2: a real input count over the cap is logged (counts only) and the summary is still saved', async () => {
    const { service, ai, tx } = setup();
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    ai.run.mockResolvedValue({ content: ANSWER, creditCost: 15, inputTokens: SUMMARY_INPUT_CAP + 1, outputTokens: 10, truncated: false });
    await service.make(TXT_FILE, ORG, ACTOR, 'en', NOW);
    expect(warn.mock.calls.map((c) => String(c[0]))).toContain(`StoredFile file-1 summary: real input ${SUMMARY_INPUT_CAP + 1} tokens over the ${SUMMARY_INPUT_CAP} cap.`);
    expect(tx.aiFileSummary.updateMany).toHaveBeenCalled();
    warn.mockRestore();
  });

  itEnforcesTenantIsolation('every read, claim, lock and write is scoped to the caller\'s organisation', async () => {
    const { service, prisma, tx } = setup();
    await service.make(TXT_FILE, ORG, ACTOR, 'en', NOW);
    const claimSql = argsOf(prisma.$queryRaw) as [TemplateStringsArray, ...unknown[]];
    expect(claimSql[0].join('?')).toContain('WHERE "AiFileSummary"."organizationId" = ?');
    expect(claimSql.slice(1)).toContain(ORG);
    expect(argsOf(tx.$queryRaw).slice(1)).toEqual(['file-1', ORG]);
    expect(prisma.aiFileSummary.findFirst).toHaveBeenCalledWith({ where: { storedFileId: 'file-1', organizationId: ORG, language: 'en' } });
    expect(tx.aiFileSummary.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ organizationId: ORG }) as unknown }));
  });
});
