import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { mkdtemp, mkdir, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import request from 'supertest';
import { App } from 'supertest/types';
import { FilesController } from './files.controller';
import { StorageResolverService } from './storage-resolver.service';
import { StorageRefusalException } from './storage-refusal';
import { GraphError } from '../../providers/storage/sharepoint/graph-client';
import { Readable } from 'stream';
import { SharePointAccessService } from './sharepoint-access.service';
import { writeStorageConfig } from './storage-config';
import { issueDownloadToken } from './download-token';
import { PrismaService } from '../../prisma/prisma.service';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { itEnforcesTenantIsolation } from '../../common/testing/tenant-isolation';

// ACC-177 — the local-folder download route, over real HTTP: no session, the
// token is the whole entitlement, and every way of being wrong is one 404.
describe('FilesController (ACC-177)', () => {
  let app: INestApplication<App>;
  let base: string;
  const saved = { key: process.env['ENCRYPTION_KEY'], base: process.env['LOCAL_STORAGE_BASE'] };
  const FILE = {
    id: 'file-1',
    organizationId: 'org-a',
    provider: 'LOCAL_FILESYSTEM',
    bucket: null,
    endpoint: null,
    rootPath: 'root-a',
    storageKey: 'org-a/tasks/task-1/abc-file.pdf',
    originalName: 'محضر الاجتماع.pdf',
    mimeType: 'application/pdf',
    sizeBytes: 9,
  };
  // ACC-185 — a local-folder failure is never a SharePoint withdrawal.
  const sharePointAccess = { refusalFor: jest.fn().mockResolvedValue(null) };
  const prisma = {
    storedFile: { findFirst: jest.fn() },
    organization: { findFirst: jest.fn() },
  };

  beforeAll(async () => {
    process.env['ENCRYPTION_KEY'] = 'f'.repeat(64);
    base = await mkdtemp(join(tmpdir(), 'acc177-stream-'));
    process.env['LOCAL_STORAGE_BASE'] = base;
    await mkdir(join(base, 'root-a', 'org-a', 'tasks', 'task-1'), { recursive: true });
    await writeFile(join(base, 'root-a', FILE.storageKey), '%PDF-1.7\n');

    const moduleRef = await Test.createTestingModule({
      controllers: [FilesController],
      providers: [
        StorageResolverService,
        { provide: PrismaService, useValue: prisma },
        { provide: SharePointAccessService, useValue: sharePointAccess },
      ],
    })
      .overrideGuard(TenantGuard)
      .useValue({ canActivate: () => true })
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });
  afterAll(async () => {
    await app.close();
    await rm(base, { recursive: true, force: true });
    process.env['ENCRYPTION_KEY'] = saved.key;
    if (saved.base === undefined) delete process.env['LOCAL_STORAGE_BASE'];
    else process.env['LOCAL_STORAGE_BASE'] = saved.base;
  });
  beforeEach(() => {
    jest.clearAllMocks();
    prisma.organization.findFirst.mockResolvedValue({ storageConfig: writeStorageConfig({ local: { rootPath: 'root-a' } }) });
  });

  it('streams the file with its Arabic name, its type, and no caching', async () => {
    prisma.storedFile.findFirst.mockResolvedValue(FILE);
    const { token } = issueDownloadToken('file-1', 'org-a');
    const res = await request(app.getHttpServer()).get(`/files/stream/${token}`);

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('application/pdf');
    // ACC-189: the viewer reads the bytes itself; nothing is ever served inline.
    expect(res.headers['content-disposition']).toMatch(/^attachment;/);
    expect(res.headers['content-disposition']).toContain(`filename*=UTF-8''${encodeURIComponent('محضر الاجتماع')}.pdf`);
    expect(res.headers['cache-control']).toBe('private, no-store');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(Buffer.from(res.body as Buffer).toString()).toBe('%PDF-1.7\n');
  });

  it('a bad or expired token, or a deleted file, is the same 404 — and a bad token never reaches the database', async () => {
    const bad = await request(app.getHttpServer()).get('/files/stream/not-a-token');
    expect(bad.status).toBe(404);
    expect(prisma.storedFile.findFirst).not.toHaveBeenCalled();

    const expired = issueDownloadToken('file-1', 'org-a', new Date(Date.now() - 16 * 60 * 1000)).token;
    expect((await request(app.getHttpServer()).get(`/files/stream/${expired}`)).status).toBe(404);

    prisma.storedFile.findFirst.mockResolvedValue(null);
    const { token } = issueDownloadToken('file-1', 'org-a');
    const gone = await request(app.getHttpServer()).get(`/files/stream/${token}`);
    expect(gone.status).toBe(404);
    expect(gone.body).toEqual(bad.body);
  });

  itEnforcesTenantIsolation('a token reads only the file it names, in the organisation it names, and only from a local folder or SharePoint', async () => {
    prisma.storedFile.findFirst.mockResolvedValue(null);
    const { token } = issueDownloadToken('file-1', 'org-b');
    expect((await request(app.getHttpServer()).get(`/files/stream/${token}`)).status).toBe(404);
    expect(prisma.storedFile.findFirst).toHaveBeenCalledWith({
      where: { id: 'file-1', organizationId: 'org-b', deletedAt: null, provider: { in: ['LOCAL_FILESYSTEM', 'SHAREPOINT'] } },
    });
  });

  // ACC-185 — SharePoint streams through here too, by its item id.
  describe('a SharePoint file', () => {
    const SP_FILE = { ...FILE, provider: 'SHAREPOINT', rootPath: null, msDriveId: 'b!drive', msItemId: 'item-9' };
    const fakeProvider = { put: jest.fn(), delete: jest.fn(), getStream: jest.fn() };
    beforeEach(() => {
      jest.spyOn(app.get(StorageResolverService), 'forFile').mockResolvedValue(fakeProvider);
    });
    afterEach(() => jest.restoreAllMocks());

    it('streams by its item id, with our own name and headers', async () => {
      prisma.storedFile.findFirst.mockResolvedValue(SP_FILE);
      fakeProvider.getStream.mockResolvedValue(Readable.from([Buffer.from('%PDF-1.7\n')]));
      const { token } = issueDownloadToken('file-1', 'org-a');
      const res = await request(app.getHttpServer()).get(`/files/stream/${token}`);
      expect(res.status).toBe(200);
      expect(fakeProvider.getStream).toHaveBeenCalledWith(SP_FILE.storageKey, 'item-9');
      expect(res.headers['content-disposition']).toContain(`filename*=UTF-8''${encodeURIComponent('محضر الاجتماع')}.pdf`);
    });

    it('withdrawn access is refused with its own code, not hidden as a 404', async () => {
      prisma.storedFile.findFirst.mockResolvedValue(SP_FILE);
      fakeProvider.getStream.mockRejectedValue(new GraphError(403, 'accessDenied', 'read'));
      sharePointAccess.refusalFor.mockResolvedValueOnce(new StorageRefusalException('STORAGE_ACCESS_WITHDRAWN'));
      const { token } = issueDownloadToken('file-1', 'org-a');
      const res = await request(app.getHttpServer()).get(`/files/stream/${token}`);
      expect(res.status).toBe(409);
      expect(res.body.code).toBe('STORAGE_ACCESS_WITHDRAWN');
      expect(sharePointAccess.refusalFor).toHaveBeenCalledWith('org-a', expect.any(GraphError), 'file');
    });

    it('a file gone inside SharePoint stays the same 404', async () => {
      prisma.storedFile.findFirst.mockResolvedValue(SP_FILE);
      fakeProvider.getStream.mockRejectedValue(new GraphError(404, 'itemNotFound', 'read'));
      sharePointAccess.refusalFor.mockResolvedValueOnce(new StorageRefusalException('FILE_UNAVAILABLE'));
      const { token } = issueDownloadToken('file-1', 'org-a');
      expect((await request(app.getHttpServer()).get(`/files/stream/${token}`)).status).toBe(404);
    });
  });

  it('upload limits name the cap and the allowed types', async () => {
    const res = await request(app.getHttpServer()).get('/files/upload-limits');
    expect(res.status).toBe(200);
    expect(res.body.maxUploadBytes).toBe(25 * 1024 * 1024);
    expect(res.body.allowedExtensions).toContain('pdf');
    expect(res.body.allowedExtensions).not.toContain('svg');
  });
});
