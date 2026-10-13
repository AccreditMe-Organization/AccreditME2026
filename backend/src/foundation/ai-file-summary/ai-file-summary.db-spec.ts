/**
 * ACC-193 — the summary's claim, save and deletes against a REAL Postgres
 * (npm run test:db).
 *
 * Only a database can prove: two presses at once make ONE model call; a
 * file's delete takes its summaries with it in the same transaction; a summary
 * in flight when its file is deleted is never saved (the StoredFile row lock,
 * §14.3); a purge deletes any left (the safety net); a restored file has none.
 * The gateway is a counting stub and the bytes a fixed TXT; everything else —
 * the claim, the save, softDeleteInTx, the purge — is the real code on real
 * rows. Fails, never skips, without a local database (ACC-120).
 */
import { randomUUID } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { AiFileSummaryService, CLAIM_STALE_MS, SummarizableFile } from './ai-file-summary.service';
import { SummaryFileGoneError } from './summary-refusal';
import { AiService } from '../ai/ai.service';
import { StoredFileService } from '../file-storage/stored-file.service';
import { RecycleBinService } from '../file-storage/recycle-bin.service';
import { StorageResolverService } from '../file-storage/storage-resolver.service';
import { StorageNoticesService } from '../file-storage/storage-notices.service';
import { SharePointAccessService } from '../file-storage/sharepoint-access.service';
import { PdfTextExtractor } from './extract/pdf-text-extractor';
import { AuditLogService } from '../../common/services/audit-log.service';

const url = process.env['DATABASE_URL'];
if (!url) throw new Error('test:db needs DATABASE_URL — it fails rather than skips without a database (ACC-120).');
const host = new URL(url).hostname;
if (!['localhost', '127.0.0.1', '::1'].includes(host)) {
  throw new Error(`test:db refuses a non-local database (${host}). It writes rows and must never reach a shared database.`);
}

jest.setTimeout(60_000);

const NOW = new Date('2026-10-13T09:00:00Z');
const TEXT = Buffer.from('The infection control policy requires hand hygiene before and after every patient contact.');
const ANSWER = '{"overview": "The policy sets hand hygiene rules.", "keyPoints": ["Before and after every contact"]}';

describe('AI file summaries against a real database (ACC-193)', () => {
  const prisma = new PrismaService();
  let modelCalls = 0;
  // Holds the gateway open until a test lets it finish: the "in flight" window.
  let gate: Promise<void> = Promise.resolve();

  const ai = {
    run: async () => {
      modelCalls += 1;
      await gate;
      await new Promise((r) => setTimeout(r, 200));
      return { content: ANSWER, creditCost: 15, inputTokens: 100, outputTokens: 40, truncated: false };
    },
  };
  // The real softDeleteInTx; readBytes is a fixed TXT (no storage on this database).
  const storedFiles = new StoredFileService(
    prisma,
    null as unknown as StorageResolverService,
    null as unknown as StorageNoticesService,
    null as unknown as SharePointAccessService,
  );
  storedFiles.readBytes = () => Promise.resolve(TEXT);
  const audit = new AuditLogService(prisma);
  const service = new AiFileSummaryService(prisma, ai as unknown as AiService, storedFiles, new PdfTextExtractor(), audit);
  const recycleBin = new RecycleBinService(
    prisma,
    { removeBytes: () => Promise.resolve(), reviewWarning: () => Promise.resolve() } as unknown as StoredFileService,
    audit,
    { assertReachable: () => Promise.resolve() } as unknown as SharePointAccessService,
  );

  async function tenantWithFile(): Promise<{ org: string; user: string; file: SummarizableFile }> {
    const slug = `acc193-${randomUUID().slice(0, 8)}`;
    const org = await prisma.organization.create({
      data: {
        name: slug,
        slug,
        country: 'SA',
        bootstrappedAt: new Date('2026-09-21T04:39:49Z'),
        aiMonthlyCredits: 2000,
        aiCreditsPeriodStart: new Date('2026-09-21T04:39:49Z'),
        aiCreditsRenewsAt: new Date('2099-01-01T00:00:00Z'),
      },
    });
    await prisma.aiFeatureCost.upsert({
      where: { featureKey: 'document_summary' },
      update: { creditCost: 15, restricted: false, allowedOrganizationIds: [] },
      create: { featureKey: 'document_summary', creditCost: 15, restricted: false },
    });
    const user = await prisma.user.create({ data: { organizationId: org.id, email: `${slug}@example.test`, name: 'Reader' } });
    const file = await prisma.storedFile.create({
      data: {
        organizationId: org.id,
        provider: 'S3',
        bucket: 'test',
        storageKey: `${org.id}/tasks/x/${randomUUID()}-policy.txt`,
        originalName: 'policy.txt',
        mimeType: 'text/plain',
        sizeBytes: TEXT.length,
        sha256: 'a'.repeat(64),
        ownerType: 'TASK',
        ownerId: 'task-x',
        uploadedById: user.id,
      },
    });
    return { org: org.id, user: user.id, file };
  }

  const softDelete = (file: SummarizableFile, org: string, user: string) =>
    prisma.$transaction((tx) => storedFiles.softDeleteInTx(tx, file.id, org, user));

  beforeAll(async () => {
    await prisma.onModuleInit();
  });
  afterAll(async () => {
    await prisma.onModuleDestroy();
  });
  beforeEach(() => {
    modelCalls = 0;
    gate = Promise.resolve();
  });

  it('two presses for one file and language at the same moment → ONE model call, one summary, the other refused 409', async () => {
    const { org, user, file } = await tenantWithFile();
    const results = await Promise.allSettled([service.make(file, org, user, 'en', NOW), service.make(file, org, user, 'en', NOW)]);
    expect(modelCalls).toBe(1);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
    expect((rejected.reason as { getResponse(): { code: string } }).getResponse().code).toBe('AI_SUMMARY_IN_PROGRESS');
    const rows = await prisma.aiFileSummary.findMany({ where: { organizationId: org } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual(expect.objectContaining({ language: 'en', creditCost: 15, generatingSince: null, overview: 'The policy sets hand hygiene rules.' }));
  });

  it('English and Arabic at once are two runs and two rows (the claim is per file AND language)', async () => {
    const { org, user, file } = await tenantWithFile();
    await Promise.all([service.make(file, org, user, 'en', NOW), service.make(file, org, user, 'ar', NOW)]);
    expect(modelCalls).toBe(2);
    expect((await prisma.aiFileSummary.findMany({ where: { storedFileId: file.id } })).map((r) => r.language).sort()).toEqual(['ar', 'en']);
  });

  it('a press after the summary exists returns it with NO call (the second visit, two people seconds apart)', async () => {
    const { org, user, file } = await tenantWithFile();
    await service.make(file, org, user, 'en', NOW);
    const again = await service.make(file, org, user, 'en', new Date(NOW.getTime() + 5_000));
    expect(modelCalls).toBe(1);
    expect(again.summary?.overview).toBe('The policy sets hand hygiene rules.');
  });

  it('a claim left by a crashed run is taken over once stale, and not before', async () => {
    const { org, user, file } = await tenantWithFile();
    await prisma.aiFileSummary.create({ data: { organizationId: org, storedFileId: file.id, language: 'en', generatingSince: NOW } });
    await expect(service.make(file, org, user, 'en', new Date(NOW.getTime() + 60_000))).rejects.toBeDefined();
    expect(modelCalls).toBe(0);
    await service.make(file, org, user, 'en', new Date(NOW.getTime() + CLAIM_STALE_MS + 1_000));
    expect(modelCalls).toBe(1);
    expect(await prisma.aiFileSummary.count({ where: { storedFileId: file.id } })).toBe(1);
  });

  it('§14.3: deleting the file deletes its English and Arabic summaries in the same transaction', async () => {
    const { org, user, file } = await tenantWithFile();
    await Promise.all([service.make(file, org, user, 'en', NOW), service.make(file, org, user, 'ar', NOW)]);
    expect(await prisma.aiFileSummary.count({ where: { storedFileId: file.id } })).toBe(2);
    await softDelete(file, org, user);
    expect(await prisma.aiFileSummary.count({ where: { storedFileId: file.id } })).toBe(0);
    expect((await prisma.storedFile.findFirstOrThrow({ where: { id: file.id } })).deletedAt).not.toBeNull();
  });

  it('§14.3: a restored file has no summary, and Summarize makes a new one', async () => {
    const { org, user, file } = await tenantWithFile();
    await service.make(file, org, user, 'en', NOW);
    await softDelete(file, org, user);
    // The restore itself, as RecycleBinService.restore() writes it. (restore()
    // also needs the file's task to exist, which this fixture has none of; it
    // touches no summary — recycle-bin.service.spec.ts.)
    await prisma.storedFile.update({ where: { id: file.id }, data: { deletedAt: null, deletedById: null, restoredAt: new Date(), restoredById: user } });
    expect(await prisma.aiFileSummary.count({ where: { storedFileId: file.id } })).toBe(0);
    expect((await service.read(file, org, 'en', NOW)).summary).toBeNull();
    await service.make(file, org, user, 'en', new Date(NOW.getTime() + 1_000));
    expect(modelCalls).toBe(2);
    expect(await prisma.aiFileSummary.count({ where: { storedFileId: file.id } })).toBe(1);
  });

  it('§14.3: a summary IN FLIGHT when its file is deleted is never saved, and leaves no row', async () => {
    const { org, user, file } = await tenantWithFile();
    let open!: () => void;
    gate = new Promise<void>((r) => (open = r));
    const making = service.make(file, org, user, 'en', NOW).catch((e: unknown) => e);
    // Wait until the claim is in and the gateway is "running".
    for (let i = 0; i < 50 && modelCalls === 0; i++) await new Promise((r) => setTimeout(r, 20));
    expect(modelCalls).toBe(1);
    await softDelete(file, org, user);
    open();
    expect(await making).toBeInstanceOf(SummaryFileGoneError);
    expect(await prisma.aiFileSummary.count({ where: { storedFileId: file.id } })).toBe(0);
    expect(await prisma.auditLog.count({ where: { organizationId: org, objectType: 'AiFileSummary' } })).toBe(0);
  });

  it('the purge deletes any summaries left (the safety net), and a purge after a delete still finds none', async () => {
    const { org, user, file } = await tenantWithFile();
    await service.make(file, org, user, 'en', NOW);
    // A row the delete could not have reached (inserted behind its back), to prove the net catches it.
    await prisma.storedFile.update({ where: { id: file.id }, data: { deletedAt: new Date(), deletedById: user } });
    expect(await prisma.aiFileSummary.count({ where: { storedFileId: file.id } })).toBe(1);
    await recycleBin.purge(org, [file.id], user);
    expect(await prisma.aiFileSummary.count({ where: { storedFileId: file.id } })).toBe(0);
    expect((await prisma.storedFile.findFirstOrThrow({ where: { id: file.id } })).purgedAt).not.toBeNull();
  });

  it('should NOT return records belonging to a different tenant — another organisation\'s file is never read, claimed or saved', async () => {
    const a = await tenantWithFile();
    const b = await tenantWithFile();
    await service.make(a.file, a.org, a.user, 'en', NOW);
    // Organisation B asks with A's file id under its own organisation id.
    const asB = { ...a.file, organizationId: b.org };
    expect((await service.read(asB, b.org, 'en', NOW)).summary).toBeNull();
    await expect(service.make(asB, b.org, b.user, 'en', NOW)).rejects.toBeDefined();
    expect(await prisma.aiFileSummary.count({ where: { organizationId: b.org } })).toBe(0);
    expect(await prisma.aiFileSummary.count({ where: { storedFileId: a.file.id } })).toBe(1);
  });
});
