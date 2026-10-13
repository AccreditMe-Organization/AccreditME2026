import { ConflictException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { TENANT_PERMISSIONS } from '../../common/constants/permissions';
import { AiService } from '../ai/ai.service';
import { AiRefusalException, AiNotEnabledReason } from '../ai/ai-refusal';
import { aiBalanceOf, openAiFeatures } from '../ai/ai-balance';
import { TaskService } from '../task/task.service';
import { TaskRequestService } from '../task/task-request.service';
import { NotificationService } from '../notification/notification.service';
import { WorkingCalendarService } from '../working-calendar/working-calendar.service';
import {
  IBriefingGroup,
  IBriefingItem,
  buildBriefingGroups,
  briefingItems,
  countsDescription,
  greetingAt,
  todayIn,
} from './briefing-groups';
import { BriefingLanguage, IBriefingFocus, briefingPrompt, briefingSystemPrompt, codeLead, parseBriefingAnswer } from './briefing-answer';
import { IBriefingView, IBriefingViewItem } from './interfaces/ai-briefing.interface';

export const BRIEFING_FEATURE = 'morning_briefing';
/** A claim older than this is a crashed run, and may be taken over (> the provider's 120 s timeout). */
export const CLAIM_STALE_MS = 3 * 60 * 1000;

export interface BriefingViewer {
  id: string;
  permissions: readonly string[];
}

/**
 * ACC-198 — the AI briefing on Home, made ON DEMAND by a tenant admin
 * (Ahmad, 12 Oct): never on a schedule, never on first open. Plan:
 * backend/Plans/step-198-morning-briefing.md.
 *
 *   - Who: a holder of tenant:manage_config (the controller's gate), where
 *     morning_briefing is open to the organisation and AI is on (D17, D13 of
 *     ACC-194). Credits used up does NOT hide the button — pressing says so.
 *   - What goes in: only the caller's own work, through the same self-scoped
 *     services My tasks and the bell use. The model sees titles and dates
 *     under keys, never a record id, description, reason or body.
 *   - What comes out: the model writes the lead and up to three focus picks
 *     by key (D13). Our code validates the picks and builds every item, date
 *     and link.
 *   - One run per user at a time (D7): one INSERT … ON CONFLICT claim.
 *   - A quiet day calls no model and costs nothing.
 *   - One row per user, the latest; shown only on the day it was made (D3).
 */
@Injectable()
export class AiBriefingService {
  private readonly logger = new Logger(AiBriefingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ai: AiService,
    private readonly tasks: TaskService,
    private readonly requests: TaskRequestService,
    private readonly notifications: NotificationService,
    private readonly calendar: WorkingCalendarService,
  ) {}

  /** GET /ai/briefing — the caller's own briefing (today's only), and whether they may make one. */
  async read(viewer: BriefingViewer, organizationId: string, now: Date = new Date()): Promise<IBriefingView> {
    const [availability, zone, row] = await Promise.all([
      this.availability(viewer, organizationId),
      this.calendar.getEffectiveTimeZone(organizationId),
      this.prisma.aiBriefing.findFirst({ where: { organizationId, userId: viewer.id, generatedAt: { not: null } } }),
    ]);
    const view: IBriefingView = {
      available: availability.available,
      creditCost: availability.creditCost,
      greeting: greetingAt(zone, now),
      briefing: null,
    };
    if (!row?.generatedAt) return view;

    // D3 — only on the day it was made, in the tenant's zone.
    const { start, end } = todayIn(zone, now);
    if (row.generatedAt.getTime() < start.getTime() || row.generatedAt.getTime() > end.getTime()) return view;

    const groups = (row.groups as unknown as IBriefingGroup[]) ?? [];
    const done = await this.doneIds(viewer.id, organizationId, groups);
    const withDone = (item: IBriefingItem): IBriefingViewItem => ({ ...item, done: done.has(`${item.type}:${item.id}`) });
    const items = briefingItems(groups);
    const focus = ((row.focus as unknown as IBriefingFocus[]) ?? [])
      .map((pick) => ({ item: items.get(pick.key), reason: pick.reason }))
      .filter((pick): pick is { item: IBriefingItem; reason: string } => !!pick.item)
      .map((pick) => ({ item: withDone(pick.item), reason: pick.reason }));

    view.briefing = {
      language: row.language === 'ar' ? 'ar' : 'en',
      lead: row.lead,
      generatedAt: row.generatedAt.toISOString(),
      creditCost: row.creditCost,
      focus,
      groups: groups.map((g) => ({ kind: g.kind, items: g.items.map(withDone) })),
    };
    return view;
  }

  /** POST /ai/briefing — make a new briefing in `language`, replacing the last. */
  async make(viewer: BriefingViewer, organizationId: string, language: BriefingLanguage, now: Date = new Date()): Promise<IBriefingView> {
    const availability = await this.availability(viewer, organizationId);
    if (!availability.available) {
      throw new AiRefusalException('AI_NOT_ENABLED', { reason: availability.reason ?? 'NO_ALLOWANCE', feature: BRIEFING_FEATURE });
    }

    const rowId = await this.claim(viewer.id, organizationId, language, now);
    if (!rowId) {
      throw new ConflictException({
        statusCode: HttpStatus.CONFLICT,
        message: 'A briefing is already being prepared',
        error: 'Conflict',
        code: 'AI_BRIEFING_IN_PROGRESS',
      });
    }

    let saved = false;
    try {
      const zone = await this.calendar.getEffectiveTimeZone(organizationId);
      const groups = buildBriefingGroups(await this.gather(viewer, organizationId), zone, now);

      let lead: string;
      let focus: IBriefingFocus[] = [];
      let creditCost = 0;
      if (groups.length === 0) {
        // A quiet day: nothing to summarise, so no model call and no charge.
        lead = codeLead(groups, language);
      } else {
        const result = await this.ai.run(
          'morning_briefing',
          { organizationId, actorId: viewer.id },
          { system: briefingSystemPrompt(language), prompt: briefingPrompt(groups, language, now), description: countsDescription(groups) },
        );
        const answer = parseBriefingAnswer(result.content, groups, language);
        if (answer.fallback) this.logger.warn(`Briefing for user ${viewer.id} in org ${organizationId}: the answer had no usable lead; ours was used.`);
        lead = answer.lead;
        focus = answer.focus;
        creditCost = result.creditCost;
      }

      await this.prisma.aiBriefing.update({
        where: { id: rowId },
        data: {
          language,
          lead,
          focus: focus as unknown as object,
          groups: groups as unknown as object,
          creditCost,
          generatedAt: new Date(),
          generatingSince: null,
        },
      });
      saved = true;
    } finally {
      if (!saved) await this.release(rowId, now);
    }
    return this.read(viewer, organizationId);
  }

  /**
   * One run per user at a time (D7), in ONE statement: insert the user's row
   * with a claim, or take the claim on the existing row only when nobody holds
   * it (or the holder crashed). Null = a run is already in flight.
   */
  private async claim(userId: string, organizationId: string, language: BriefingLanguage, now: Date): Promise<string | null> {
    const staleBefore = new Date(now.getTime() - CLAIM_STALE_MS);
    const rows = await this.prisma.$queryRaw<{ id: string }[]>`
      INSERT INTO "AiBriefing" ("id", "organizationId", "userId", "language", "lead", "focus", "groups", "creditCost", "generatingSince", "updatedAt")
      VALUES (${randomUUID()}, ${organizationId}, ${userId}, ${language}, '', '[]'::jsonb, '[]'::jsonb, 0, ${now}, ${now})
      ON CONFLICT ("organizationId", "userId") DO UPDATE SET "generatingSince" = ${now}
      WHERE "AiBriefing"."generatingSince" IS NULL OR "AiBriefing"."generatingSince" < ${staleBefore}
      RETURNING "id"`;
    return rows[0]?.id ?? null;
  }

  /** Release our own claim only — never a later run's. */
  private async release(rowId: string, claimedAt: Date): Promise<void> {
    try {
      await this.prisma.$executeRaw`
        UPDATE "AiBriefing" SET "generatingSince" = NULL WHERE "id" = ${rowId} AND "generatingSince" = ${claimedAt}`;
    } catch (error) {
      this.logger.error(`Could not release the briefing claim ${rowId}: ${(error as Error).message}`);
    }
  }

  private async availability(
    viewer: BriefingViewer,
    organizationId: string,
  ): Promise<{ available: boolean; reason?: AiNotEnabledReason; creditCost: number | null }> {
    if (!viewer.permissions.includes(TENANT_PERMISSIONS.MANAGE_CONFIG)) return { available: false, creditCost: null };
    const [org, features] = await Promise.all([
      this.prisma.organization.findFirst({
        where: { id: organizationId },
        select: {
          aiMonthlyCredits: true,
          aiPendingMonthlyCredits: true,
          aiCreditsUsed: true,
          aiCreditsPeriodStart: true,
          aiCreditsRenewsAt: true,
          bootstrappedAt: true,
          createdAt: true,
          settings: true,
        },
      }),
      openAiFeatures(this.prisma, organizationId),
    ]);
    const feature = features.find((f) => f.key === BRIEFING_FEATURE);
    if (!org || !feature) return { available: false, reason: 'FEATURE_NOT_AVAILABLE', creditCost: null };
    const balance = aiBalanceOf(org);
    if (!balance.enabled) {
      return { available: false, reason: balance.monthlyCredits > 0 ? 'SWITCHED_OFF' : 'NO_ALLOWANCE', creditCost: feature.creditCost };
    }
    return { available: true, creditCost: feature.creditCost };
  }

  /** The caller's own work, from the self-scoped services My tasks and the bell use. */
  private async gather(viewer: BriefingViewer, organizationId: string) {
    const [myTasks, pool, decisions, notifications] = await Promise.all([
      this.tasks.getMyTasks(viewer.id, organizationId, {}, viewer.permissions),
      this.tasks.getAvailableToPick(viewer.id, organizationId, viewer.permissions),
      this.requests.awaitingDecision({ id: viewer.id, permissions: viewer.permissions }, organizationId),
      this.notifications.getForUser(viewer.id, organizationId, { status: 'UNREAD', pageSize: 20 }),
    ]);
    return { myTasks, pool, decisions, notifications: notifications.data };
  }

  /** Live "done" markers (drawing Q6): the snapshot's wording never changes. */
  private async doneIds(userId: string, organizationId: string, groups: readonly IBriefingGroup[]): Promise<Set<string>> {
    const ids = (type: IBriefingItem['type']) => [...new Set(groups.flatMap((g) => g.items.filter((i) => i.type === type).map((i) => i.id)))];
    const taskIds = ids('TASK');
    const requestIds = ids('TASK_REQUEST');
    const noteIds = ids('NOTIFICATION');
    const [tasks, requests, notes] = await Promise.all([
      taskIds.length
        ? this.prisma.task.findMany({ where: { organizationId, id: { in: taskIds }, status: { in: ['COMPLETED', 'CANCELLED'] } }, select: { id: true } })
        : [],
      requestIds.length
        ? this.prisma.taskRequest.findMany({ where: { organizationId, id: { in: requestIds }, status: { not: 'PENDING' } }, select: { id: true } })
        : [],
      noteIds.length
        ? this.prisma.notification.findMany({ where: { organizationId, userId, id: { in: noteIds }, status: { not: 'UNREAD' } }, select: { id: true } })
        : [],
    ]);
    return new Set([
      ...tasks.map((t) => `TASK:${t.id}`),
      ...requests.map((r) => `TASK_REQUEST:${r.id}`),
      ...notes.map((n) => `NOTIFICATION:${n.id}`),
    ]);
  }
}
