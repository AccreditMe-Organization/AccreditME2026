import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { TenantModule } from '../tenant/tenant.module';
import { LookupController } from './lookup.controller';
import { LookupService } from './lookup.service';

@Module({
  imports:     [PrismaModule, TenantModule],
  controllers: [LookupController],
  providers:   [LookupService],
  exports:     [LookupService],
})
export class LookupModule {}
