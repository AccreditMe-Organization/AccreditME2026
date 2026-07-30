import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

type AuditActionValue =
  | 'CREATE'
  | 'UPDATE'
  | 'DELETE'
  | 'VIEW'
  | 'LOGIN'
  | 'LOGOUT'
  | 'EXPORT'
  | 'IMPORT'
  | 'SUBMIT'
  | 'APPROVE'
  | 'REJECT'
  | 'PUBLISH'
  | 'ARCHIVE'
  | 'RESTORE'
  | 'DELEGATE'
  | 'IMPERSONATE_START'
  | 'IMPERSONATE_END';

export interface AuditLogEntry {
  action: AuditActionValue;
  objectType: string;
  objectId?: string;
  actorId?: string;
  tenantId: string;
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  ipAddress?: string;
}

@Injectable()
export class AuditLogService {
  constructor(private readonly prisma: PrismaService) {}

  async log(entry: AuditLogEntry): Promise<void> {
    await this.prisma.auditLog.create({
      data: {
        organizationId: entry.tenantId,
        actorId: entry.actorId ?? null,
        action: entry.action,
        objectType: entry.objectType,
        objectId: entry.objectId ?? null,
        before: entry.before as object | undefined,
        after: entry.after as object | undefined,
        metadata: entry.metadata as object | undefined,
        ipAddress: entry.ipAddress ?? null,
      },
    });
  }
}
