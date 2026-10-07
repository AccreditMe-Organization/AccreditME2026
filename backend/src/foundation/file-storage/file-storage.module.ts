import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { AuditLogService } from '../../common/services/audit-log.service';
import { StorageResolverService } from './storage-resolver.service';
import { StoredFileService } from './stored-file.service';
import { StorageSettingsService } from './storage-settings.service';
import { StorageSettingsController } from './storage-settings.controller';
import { FilesController } from './files.controller';

// ACC-177 — file storage per organisation. Modules that attach files import
// this and use StoredFileService; nothing outside it builds a provider
// (StorageResolverService is the one place).
//
// AuditLogService is provided here rather than imported through TenantModule:
// it is stateless over PrismaService, and importing TenantModule would pull
// its forwardRef web into every module that stores a file.
@Module({
  imports: [PrismaModule],
  controllers: [StorageSettingsController, FilesController],
  providers: [StorageResolverService, StoredFileService, StorageSettingsService, AuditLogService],
  exports: [StoredFileService],
})
export class FileStorageModule {}
