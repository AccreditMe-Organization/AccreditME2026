import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogService } from '../../common/services/audit-log.service';
import { UpdateTenantDto } from './dto/update-tenant.dto';
import { ITenant, ITenantConfig } from './interfaces/tenant.interface';

const CIPHER = 'aes-256-gcm';
const IV_BYTES = 12;

@Injectable()
export class TenantService {
  private readonly encryptionKey: Buffer;

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLog: AuditLogService,
  ) {
    this.encryptionKey = Buffer.from(
      process.env['ENCRYPTION_KEY'] ?? '',
      'hex',
    );

    if (this.encryptionKey.length !== 32) {
      throw new Error(
        'ENCRYPTION_KEY must be a 32-byte hex string (64 hex chars). ' +
          'Generate with: openssl rand -hex 32',
      );
    }
  }

  async findById(id: string): Promise<ITenant> {
    const org = await this.prisma.organization.findUnique({ where: { id } });
    if (!org) throw new NotFoundException('Tenant not found');
    return {
      id: org.id,
      name: org.name,
      slug: org.slug,
      country: org.country,
      timezone: org.timezone,
      language: org.language,
      authProvider: org.authProvider,
      storageProvider: org.storageProvider,
      aiProvider: org.aiProvider,
      plan: org.plan,
      status: org.status,
      trialEndsAt: org.trialEndsAt,
      maxUsers: org.maxUsers,
      maxStorageGb: org.maxStorageGb,
      isBootstrapped: org.isBootstrapped,
      bootstrappedAt: org.bootstrappedAt,
      createdAt: org.createdAt,
      updatedAt: org.updatedAt,
    };
  }

  async update(
    id: string,
    dto: UpdateTenantDto,
    actorId: string,
  ): Promise<ITenant> {
    await this.findById(id);

    const updated = await this.prisma.organization.update({
      where: { id },
      data: dto,
    });

    await this.auditLog.log({
      action: 'UPDATE',
      objectType: 'Organization',
      objectId: id,
      actorId,
      tenantId: id,
      after: dto as Record<string, unknown>,
    });

    return {
      id: updated.id,
      name: updated.name,
      slug: updated.slug,
      country: updated.country,
      timezone: updated.timezone,
      language: updated.language,
      authProvider: updated.authProvider,
      storageProvider: updated.storageProvider,
      aiProvider: updated.aiProvider,
      plan: updated.plan,
      status: updated.status,
      trialEndsAt: updated.trialEndsAt,
      maxUsers: updated.maxUsers,
      maxStorageGb: updated.maxStorageGb,
      isBootstrapped: updated.isBootstrapped,
      bootstrappedAt: updated.bootstrappedAt,
      createdAt: updated.createdAt,
      updatedAt: updated.updatedAt,
    };
  }

  async getTenantConfig(id: string): Promise<ITenantConfig> {
    const org = await this.prisma.organization.findUnique({ where: { id } });
    if (!org) throw new NotFoundException('Tenant not found');

    return {
      authProvider: org.authProvider,
      storageProvider: org.storageProvider,
      aiProvider: org.aiProvider,
      authConfig: org.authConfig
        ? (JSON.parse(
            this.decryptConfig(org.authConfig),
          ) as Record<string, unknown>)
        : null,
      storageConfig: org.storageConfig
        ? (JSON.parse(
            this.decryptConfig(org.storageConfig),
          ) as Record<string, unknown>)
        : null,
      aiConfig: org.aiConfig
        ? (JSON.parse(
            this.decryptConfig(org.aiConfig),
          ) as Record<string, unknown>)
        : null,
    };
  }

  async bootstrap(id: string, actorId: string): Promise<void> {
    const org = await this.prisma.organization.findUnique({ where: { id } });
    if (!org) throw new NotFoundException('Tenant not found');
    if (org.isBootstrapped) {
      throw new ConflictException('Tenant has already been bootstrapped');
    }

    // TODO(Step 4 — Lookup): seed system lookup values for this tenant
    // TODO(Step 5 — Roles): create default roles (Admin, Quality Manager, Staff)
    // TODO(Step 6 — Workflow): create default workflow templates per object type
    // TODO(Step 7 — Notifications): register default notification rules

    await this.prisma.organization.update({
      where: { id },
      data: { isBootstrapped: true, bootstrappedAt: new Date() },
    });

    await this.auditLog.log({
      action: 'CREATE',
      objectType: 'TenantBootstrap',
      objectId: id,
      actorId,
      tenantId: id,
    });
  }

  encryptConfig(data: Record<string, unknown>): string {
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv(CIPHER, this.encryptionKey, iv);
    const text = JSON.stringify(data);
    const encrypted = Buffer.concat([
      cipher.update(text, 'utf8'),
      cipher.final(),
    ]);
    const tag = cipher.getAuthTag();
    return `${iv.toString('hex')}:${tag.toString('hex')}:${encrypted.toString('hex')}`;
  }

  private decryptConfig(encrypted: string): string {
    const parts = encrypted.split(':');
    if (parts.length !== 3) throw new Error('Invalid encrypted config format');
    const [ivHex, tagHex, ciphertextHex] = parts as [string, string, string];
    const iv = Buffer.from(ivHex, 'hex');
    const tag = Buffer.from(tagHex, 'hex');
    const ciphertext = Buffer.from(ciphertextHex, 'hex');
    const decipher = createDecipheriv(CIPHER, this.encryptionKey, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]).toString('utf8');
  }
}
