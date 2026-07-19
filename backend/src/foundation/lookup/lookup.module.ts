import { Module, forwardRef } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { TenantModule } from '../tenant/tenant.module';
import { LookupController } from './lookup.controller';
import { LookupService } from './lookup.service';

@Module({
  imports:     [PrismaModule, forwardRef(() => TenantModule)],
  controllers: [LookupController],
  providers:   [LookupService],
  exports:     [LookupService],
})
export class LookupModule {}
