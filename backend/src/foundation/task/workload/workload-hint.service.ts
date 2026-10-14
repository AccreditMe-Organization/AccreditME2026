import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { AiService } from '../../ai/ai.service';
import { AiRefusalException } from '../../ai/ai-refusal';
import { aiFeatureAvailability } from '../../ai/ai-availability';
import { AssignmentViewer } from '../task-assignment.service';
import { IWorkloadHint, IWorkloadHintAvailability } from '../interfaces/task-assignment.interface';
import { WorkloadHintDto } from '../dto/workload-hint.dto';
import { IRecordRef } from './task-workload';
import { IWorkloadPerson, TaskWorkloadService, canSuggestFor } from './task-workload.service';
import { MAX_OTHERS, hintPrompt, hintSystemPrompt, labelCandidates, parseHintAnswer } from './workload-hint-answer';
import { WorkloadRefusalException } from './workload-refusal';

export const WORKLOAD_FEATURE = 'workload_balancing';

/**
 * ACC-199 — "✦ Suggest someone", pressed. Plan:
 * backend/Plans/step-199-workload-hint.md §7. NOTHING IS STORED: the answer
 * goes back to the dialog, and only a FOLLOWED suggestion is ever recorded, on
 * the task's own audit row when it is saved (TaskService).
 *
 * suggest(), in order:
 *   1. The record's task list is visible to the caller — tasks:view, then the
 *      record (ACC-101: 403 naming the permission before any read; 404 for a
 *      record that is not theirs). The counts are that list's.
 *   2. The target, through the picker's own lists — which apply the picker's
 *      own rule (tasks:create, or reassigning this task; committees:view for a
 *      committee). A committee role only on that committee's own record.
 *   3. The chosen person is one of them — else 400.
 *   4. The counts and the threshold, recomputed here; the screen's "may
 *      suggest" is a reason to ask, never a fact. Not past it →
 *      WORKLOAD_NO_SUGGESTION, no call, no charge.
 *   5. AI is available for the organisation — else the gateway's AI_NOT_ENABLED.
 *   6. The gateway, with accept(): a label we did not send, or no answer, is
 *      refunded. "Nobody is clearly better placed" is refunded too, and is its
 *      own refusal.
 */
@Injectable()
export class WorkloadHintService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ai: AiService,
    private readonly workload: TaskWorkloadService,
  ) {}

  /** Whether to show "✦ Suggest someone" at all. Says nothing about the balance. */
  async availability(organizationId: string): Promise<IWorkloadHintAvailability> {
    const { available } = await aiFeatureAvailability(this.prisma, organizationId, WORKLOAD_FEATURE);
    return { available };
  }

  async suggest(viewer: AssignmentViewer, organizationId: string, dto: WorkloadHintDto): Promise<IWorkloadHint> {
    const record: IRecordRef = { sourceType: dto.sourceType, sourceId: dto.sourceId };
    await this.workload.assertMayCount(viewer, organizationId, record);

    const holders = await this.eligible(viewer, organizationId, dto, record);
    if (!holders.some((h) => h.id === dto.chosenUserId)) {
      throw new BadRequestException('The chosen person cannot take this task here');
    }

    const people = await this.workload.people(organizationId, holders, record, { excludeTaskId: dto.taskId, withDueSoon: true });
    const chosen = people.find((p) => p.holder.id === dto.chosenUserId)!;
    if (!canSuggestFor(chosen, people)) throw new WorkloadRefusalException('WORKLOAD_NO_SUGGESTION');

    const availability = await aiFeatureAvailability(this.prisma, organizationId, WORKLOAD_FEATURE);
    if (!availability.available) {
      throw new AiRefusalException('AI_NOT_ENABLED', { reason: availability.reason, feature: WORKLOAD_FEATURE });
    }

    // Q6 — nobody out of office is offered; the least loaded first, at most 15.
    const others = people
      .filter((p) => p !== chosen && !p.outOfOffice)
      .sort((a, b) => a.workload.open - b.workload.open || a.workload.overdue - b.workload.overdue)
      .slice(0, MAX_OTHERS);
    const labelled = labelCandidates<IWorkloadPerson>(chosen, others);
    const otherLabels = new Set(labelled.others.map((o) => o.label));

    let none = false;
    let picked: string | null = null;
    let result;
    try {
      result = await this.ai.run(
        WORKLOAD_FEATURE,
        { organizationId, actorId: viewer.id },
        {
          system: hintSystemPrompt(),
          prompt: hintPrompt({
            recordType: record.sourceType,
            priority: dto.priority ?? null,
            chosen: { label: labelled.chosen.label, workload: chosen.workload },
            others: labelled.others.map((o) => ({ label: o.label, workload: o.item.workload })),
          }),
          // Ids and counts only: never a name.
          description: `workload hint · ${record.sourceType} ${record.sourceId} · ${dto.committeeId ? 'COMMITTEE_ROLE' : 'POSITION'} · ${others.length} eligible · chosen ${chosen.holder.id}`,
          accept: (content, truncated) => {
            if (truncated) return false;
            const parsed = parseHintAnswer(content, otherLabels);
            none = parsed.kind === 'none';
            picked = parsed.kind === 'pick' ? parsed.label : null;
            return parsed.kind === 'pick';
          },
        },
      );
    } catch (error) {
      // The gateway has already refunded it.
      if (none && error instanceof AiRefusalException && error.code === 'AI_PROVIDER_FAILED') {
        throw new WorkloadRefusalException('WORKLOAD_NO_SUGGESTION');
      }
      throw error;
    }

    const suggested = labelled.others.find((o) => o.label === picked)?.item;
    // accept() let it through, so the label is one we sent; the guard is for the type.
    if (!suggested) throw new AiRefusalException('AI_PROVIDER_FAILED');
    return {
      interactionId: result.interactionId,
      chosen: { userId: chosen.holder.id, openCount: chosen.workload.open, overdueCount: chosen.workload.overdue },
      suggestion: {
        userId: suggested.holder.id,
        name: suggested.holder.name,
        positionNameEn: suggested.holder.positionNameEn,
        positionNameAr: suggested.holder.positionNameAr,
        openCount: suggested.workload.open,
        overdueCount: suggested.workload.overdue,
      },
    };
  }

  /** The people the picker lists for this target, under the picker's own rule. */
  private async eligible(viewer: AssignmentViewer, organizationId: string, dto: WorkloadHintDto, record: IRecordRef) {
    if (dto.committeeId && dto.roleValueId) {
      // As resolvePlacement(): a committee role only on that committee's own task.
      if (record.sourceType !== 'COMMITTEE' || record.sourceId !== dto.committeeId) {
        throw new BadRequestException('A committee role can only be chosen for a task on that committee');
      }
      return this.workload.listCommitteeMembers(viewer, organizationId, {
        committeeId: dto.committeeId,
        roleValueId: dto.roleValueId,
        taskId: dto.taskId,
      });
    }
    if (dto.orgUnitId && dto.positionId) {
      return this.workload.listHolders(viewer, organizationId, {
        orgUnitId: dto.orgUnitId,
        positionId: dto.positionId,
        taskId: dto.taskId,
      });
    }
    throw new BadRequestException('Name a unit and position, or a committee and role');
  }
}
