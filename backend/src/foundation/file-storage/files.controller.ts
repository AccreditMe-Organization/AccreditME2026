import { Controller, Get, Logger, NotFoundException, Param, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { PrismaService } from '../../prisma/prisma.service';
import { contentDisposition } from '../../providers/storage/content-disposition';
import { ALLOWED_EXTENSIONS } from './file-content';
import { readDownloadToken } from './download-token';
import { maxUploadBytes } from './storage-platform-env';
import { StorageResolverService } from './storage-resolver.service';
import { SharePointAccessService } from './sharepoint-access.service';

/**
 * ACC-177 — the two file routes that belong to no module.
 *
 * GET /files/upload-limits — what the upload screen shows before anyone picks a
 *   file: the size cap and the allowed types. Any signed-in user.
 *
 * GET /files/stream/:token — a LOCAL-FOLDER or SHAREPOINT file's download
 *   (ACC-185: SharePoint streams through here, so the saved name is ours and the
 *   entitlement stays AccreditMe's). Deliberately has
 *   NO session guard: the token IS the entitlement (download-token.ts), minted
 *   only after the owning module's permission check, bound to one file in one
 *   organisation, valid fifteen minutes — the local equivalent of an S3
 *   pre-signed URL, so a browser can simply open it. Anything wrong with the
 *   token, or a file deleted since, is the same 404.
 */
@Controller('files')
export class FilesController {
  private readonly logger = new Logger(FilesController.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly resolver: StorageResolverService,
    private readonly sharePointAccess: SharePointAccessService,
  ) {}

  @Get('upload-limits')
  @UseGuards(TenantGuard)
  uploadLimits(): { maxUploadBytes: number; allowedExtensions: readonly string[] } {
    return { maxUploadBytes: maxUploadBytes(), allowedExtensions: ALLOWED_EXTENSIONS };
  }

  @Get('stream/:token')
  async stream(@Param('token') token: string, @Res() res: Response): Promise<void> {
    const claim = readDownloadToken(token);
    const file = claim
      ? await this.prisma.storedFile.findFirst({
          where: { id: claim.fileId, organizationId: claim.organizationId, deletedAt: null, provider: { in: ['LOCAL_FILESYSTEM', 'SHAREPOINT'] } },
        })
      : null;
    if (!file) throw new NotFoundException('File not found');

    const provider = await this.resolver.forFile(file);
    let body: NodeJS.ReadableStream;
    try {
      body = await provider.getStream(file.storageKey, file.msItemId);
    } catch (error) {
      // ACC-185 — SharePoint access withdrawn: stamped once, refused with its
      // own code. Anything else stays the same 404 as before.
      const refusal = await this.sharePointAccess.refusalFor(file.organizationId, error, 'file');
      if (refusal && refusal.code === 'STORAGE_ACCESS_WITHDRAWN') throw refusal;
      this.logger.error(`File ${file.id} (${file.provider}) in org ${file.organizationId} could not be read: ${(error as Error).message}`);
      throw new NotFoundException('File not found');
    }

    res.setHeader('Content-Type', file.mimeType);
    res.setHeader('Content-Length', String(file.sizeBytes));
    res.setHeader('Content-Disposition', contentDisposition(file.originalName));
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'private, no-store');
    body.pipe(res);
  }
}
