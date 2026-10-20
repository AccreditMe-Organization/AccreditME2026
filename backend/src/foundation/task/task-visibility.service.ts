import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { TaskAuthorityService } from './task-authority.service';
import {
  buildTaskVisibilityContext,
  seesWholeRecord,
  taskVisibleSql,
  TaskVisibilityContext,
  TaskVisibilityViewer,
  unitScopeCoversRecord,
} from './task-visibility';

/**
 * ACC-244 — the task visibility rule (task-visibility.ts) as a service. Every
 * reader that asks "may this viewer see this task, or these tasks?" comes here.
 */
@Injectable()
export class TaskVisibilityService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authority: TaskAuthorityService,
  ) {}

  contextFor(viewer: TaskVisibilityViewer, organizationId: string, now: Date = new Date()): Promise<TaskVisibilityContext> {
    return buildTaskVisibilityContext(this.prisma, this.authority, viewer, organizationId, now);
  }

  /** The rule for one task: the same condition every list uses, on one row. */
  async isVisible(ctx: TaskVisibilityContext, taskId: string): Promise<boolean> {
    const rows = await this.prisma.$queryRaw<{ ok: boolean }[]>`
      SELECT EXISTS (SELECT 1 FROM "Task" t
        WHERE t.id = ${taskId} AND t."organizationId" = ${ctx.organizationId} AND ${taskVisibleSql(ctx)}) AS ok`;
    return !!rows[0]?.ok;
  }

  seesWholeRecord(ctx: TaskVisibilityContext, sourceType: string, sourceId: string): Promise<boolean> {
    return seesWholeRecord(this.prisma, ctx, sourceType, sourceId);
  }

  unitScopeCoversRecord(ctx: TaskVisibilityContext, sourceType: string, sourceId: string): Promise<boolean> {
    return unitScopeCoversRecord(this.prisma, ctx, sourceType, sourceId);
  }
}
