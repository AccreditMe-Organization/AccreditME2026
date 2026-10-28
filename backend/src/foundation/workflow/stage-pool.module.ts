import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { StagePoolService } from './stage-pool.service';

// ACC-271 — its own module because it depends on Prisma alone: WorkflowModule
// (the engine) and UserModule (the leaver events on deactivation) both import
// it, and neither gains an edge into the other's DI graph.
@Module({
  imports: [PrismaModule],
  providers: [StagePoolService],
  exports: [StagePoolService],
})
export class StagePoolModule {}
