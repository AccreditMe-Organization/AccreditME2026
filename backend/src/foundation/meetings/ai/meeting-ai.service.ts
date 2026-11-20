import { Injectable, Logger } from '@nestjs/common';
import { DateTime } from 'luxon';
import { PrismaService } from '../../../prisma/prisma.service';
import { ObjectVisibilityService } from '../../../common/services/object-visibility.service';
import { AiService } from '../../ai/ai.service';
import { AiRefusalException } from '../../ai/ai-refusal';
import { AI_FEATURES, aiFeatureTimeoutMs } from '../../ai/ai.config';
import { aiFeaturesAvailability } from '../../ai/ai-availability';
import { StageRulesService, type StageRules } from '../../workflow/stage-rules.service';
import type { EngineTx } from '../../workflow/workflow.service';
import { MEETING_ACTIONS } from '../../workflow/record-registry';
import { isMeetingKindMember, type MeetingOwner } from '../../workflow/meeting-authority';
import { WorkingCalendarService } from '../../working-calendar/working-calendar.service';
import { MeetingAccess, asMeetingConflict, lockMeetingRow, type MeetingViewer } from '../meeting-access';
import { MeetingRefusal } from '../meeting-refusal';
import { MeetingMinutesService, type AiDraftWrite } from '../meeting-minutes.service';
import { minutesPhase } from '../meeting-minutes-rules';
import { NameTable, type NameSource } from './meeting-ai-names';
import {
  ITEMS_PER_CALL,
  dueInstant,
  minutesInputTokens,
  minutesPrompt,
  minutesSystemPrompt,
  parseMinutesAnswer,
  type DraftParts,
  type MinutesItemInput,
  type MinutesLanguage,
  type ParsedAction,
} from './minutes-draft-answer';
import type {
  IMeetingAi,
  IMeetingAiAccepted,
  IMeetingAiActionSuggestion,
  IMeetingAiMinutesSuggestion,
  IMeetingAiOwnerReason,
} from './interfaces/meeting-ai.interface';
import type { AcceptMeetingAiDto, DraftMinutesAiDto, MeetingAiNotesDto } from './dto/meeting-ai.dto';

export const MINUTES_FEATURE = 'minutes_drafting' as const;
/**
 * A claim older than this is a crashed run, and may be taken over: the
 * feature's own call timeout plus a minute for the reads and the save around
 * it (P249), so a live run never looks stale.
 */
export const MEETING_AI_CLAIM_STALE_MS = aiFeatureTimeoutMs(MINUTES_FEATURE) + 60_000;

/** What a stored minutes suggestion holds (names already written back). */
interface MinutesPayload {
  nothing: boolean;
  discussion: string | null;
  decisions: { text: string; votes: { for: number; against: number; abstain: number } | null }[];
}

/** What a stored action suggestion holds (names already written back). */
interface ActionPayload {
  title: string;
  owner: { userId: string; name: string } | null;
  ownerReason: IMeetingAiOwnerReason;
  dueAt: string | null;
  dueReason: { code: 'DATE_PASSED'; day: string } | null;
}

interface DraftTarget extends MinutesItemInput {
  agendaItemId: string;
}

/**
 * ACC-322 PR 1 — Draft minutes, with the action items (plan step-322 §1.2).
 *
 * WHO: whoever records the minutes (meeting-authority.ts's RECORDERS), else
 * MEETING_NOT_RECORDER, after the meeting's own visibility (the identical 404
 * a missing meeting gets). WHERE: the minutes are a draft, the stage allows
 * `record_minutes`, and the meeting was never returned (`reviewRound === 0`,
 * M9), else MEETING_AI_NOT_OFFERED with the stage's names.
 *
 * A PRESS, in order:
 *   1. the person and the gate;
 *   2. the writer's own notes, else MEETING_AI_NO_NOTES;
 *   3. the items to draft by part (M8), at most ITEMS_PER_CALL, else
 *      MEETING_AI_NOTHING_TO_DRAFT;
 *   4. names replaced in every text (meeting-ai-names.ts), the prompt built,
 *      and its input counted: over the cap is MEETING_AI_TOO_LONG;
 *   5. ONE run per meeting and feature: an INSERT … ON CONFLICT claim, else
 *      MEETING_AI_IN_PROGRESS. 1–5 all happen before any credit is reserved;
 *   6. the gateway, with accept(): an answer we cannot use is refunded, and an
 *      all-"nothing" answer is MEETING_AI_NOTHING_SUGGESTED;
 *   7. the save, in ONE transaction under the minutes' lock order (the
 *      instance FOR SHARE, the meeting row FOR UPDATE) that re-checks the
 *      stage and M9: a meeting that moved on saves nothing and is charged
 *      (MEETING_CHANGED). The claim is released on every exit.
 *
 * A run the person left (the page closed) is still saved and charged: the
 * server finishes the call (ACC-193 Q2).
 *
 * Accept writes through MeetingMinutesService.applyAiDraft(), so the minutes
 * keep one owner. Nothing here logs customer text: the AI log's description
 * is ids and counts.
 */
@Injectable()
export class MeetingAiService {
  private readonly logger = new Logger(MeetingAiService.name);
  private readonly access: MeetingAccess;

  constructor(
    private readonly prisma: PrismaService,
    visibility: ObjectVisibilityService,
    private readonly stageRules: StageRulesService,
    private readonly ai: AiService,
    private readonly minutes: MeetingMinutesService,
    private readonly calendar: WorkingCalendarService,
  ) {
    this.access = new MeetingAccess(prisma, visibility);
  }

  // ── Read ────────────────────────────────────────────────────────────────────

  async getAi(id: string, organizationId: string, viewer: MeetingViewer, now: Date = new Date()): Promise<IMeetingAi> {
    const owner = await this.access.seeing(id, organizationId, viewer, now);
    const [recorder, gate, availability] = await Promise.all([
      this.isRecorder(owner, organizationId, viewer.id, now),
      this.minutesGate(id, organizationId),
      aiFeaturesAvailability(this.prisma, organizationId, [MINUTES_FEATURE]),
    ]);
    const minutesAvailability = availability[MINUTES_FEATURE];
    const empty: IMeetingAi = {
      minutes: { may: false, available: minutesAvailability.available, creditCost: minutesAvailability.creditCost, running: false },
      notes: null,
      presentMembers: 0,
      suggestions: { minutes: [], actions: [] },
      undecided: 0,
    };
    // Nobody but whoever records the minutes sees a trigger, a suggestion, the notes or a count; and only while they are a draft.
    if (!recorder || !gate.draft) return empty;

    const staleBefore = new Date(now.getTime() - MEETING_AI_CLAIM_STALE_MS);
    const [notes, rows, run, present, items] = await Promise.all([
      this.prisma.meetingAiNotes.findFirst({ where: { organizationId, meetingId: id, writerId: viewer.id }, select: { text: true } }),
      this.prisma.meetingAiSuggestion.findMany({
        where: { organizationId, meetingId: id, kind: { in: ['ITEM_MINUTES', 'ACTION_ITEM'] } },
        select: { id: true, agendaItemId: true, kind: true, order: true, language: true, payload: true },
        orderBy: [{ order: 'asc' }, { id: 'asc' }],
      }),
      this.prisma.meetingAiRun.findFirst({ where: { organizationId, meetingId: id, kind: 'MINUTES' }, select: { claimedAt: true } }),
      this.prisma.meetingAttendee.count({ where: { organizationId, meetingId: id, kind: 'MEMBER', attendance: 'PRESENT' } }),
      this.prisma.agendaItem.findMany({
        where: { organizationId, meetingId: id },
        select: { id: true, order: true, discussion: true, _count: { select: { decisions: true } } },
      }),
    ]);
    const itemById = new Map(items.map((i) => [i.id, i]));
    const agendaOrder = (agendaItemId: string | null) => itemById.get(agendaItemId ?? '')?.order ?? Number.MAX_SAFE_INTEGER;
    const sorted = [...rows].sort((a, b) => agendaOrder(a.agendaItemId) - agendaOrder(b.agendaItemId) || a.order - b.order);

    const minutes: IMeetingAiMinutesSuggestion[] = [];
    const actions: IMeetingAiActionSuggestion[] = [];
    for (const row of sorted) {
      if (!row.agendaItemId) continue;
      const language = row.language === 'ar' ? 'ar' : 'en';
      if (row.kind === 'ITEM_MINUTES') {
        const p = row.payload as unknown as MinutesPayload;
        const item = itemById.get(row.agendaItemId);
        minutes.push({
          id: row.id,
          agendaItemId: row.agendaItemId,
          language,
          nothing: p.nothing,
          discussion: p.discussion,
          decisions: p.decisions.map((d) => ({ ...d, abovePresent: !!d.votes && d.votes.for + d.votes.against + d.votes.abstain > present })),
          replaces: {
            discussion: p.discussion !== null && !!item?.discussion,
            decisions: p.decisions.length > 0 && (item?._count.decisions ?? 0) > 0,
          },
        });
      } else {
        const p = row.payload as unknown as ActionPayload;
        actions.push({ id: row.id, agendaItemId: row.agendaItemId, language, ...p });
      }
    }
    return {
      minutes: {
        may: gate.offered,
        available: minutesAvailability.available,
        creditCost: minutesAvailability.creditCost,
        running: !!run?.claimedAt && run.claimedAt >= staleBefore,
      },
      notes: notes?.text ?? null,
      presentMembers: present,
      suggestions: { minutes, actions },
      undecided: rows.length,
    };
  }

  // ── The rough notes ─────────────────────────────────────────────────────────

  /** Saved as typed (debounced), behind Draft minutes' own gate, read only by their writer (M3). Empty removes them. */
  async saveNotes(id: string, dto: MeetingAiNotesDto, organizationId: string, viewer: MeetingViewer, now: Date = new Date()): Promise<{ notes: string | null }> {
    await this.assertMayDraftMinutes(id, organizationId, viewer, now);
    if (!dto.text) {
      await this.prisma.meetingAiNotes.deleteMany({ where: { organizationId, meetingId: id, writerId: viewer.id } });
      return { notes: null };
    }
    const row = await this.prisma.meetingAiNotes.upsert({
      where: { meetingId_writerId: { meetingId: id, writerId: viewer.id } },
      create: { organizationId, meetingId: id, writerId: viewer.id, text: dto.text },
      update: { text: dto.text },
      select: { text: true },
    });
    return { notes: row.text };
  }

  // ── Draft minutes ───────────────────────────────────────────────────────────

  async draftMinutes(id: string, dto: DraftMinutesAiDto, organizationId: string, viewer: MeetingViewer, now: Date = new Date()): Promise<IMeetingAi> {
    const language: MinutesLanguage = dto.language;
    await this.assertMayDraftMinutes(id, organizationId, viewer, now);

    const notes = await this.prisma.meetingAiNotes.findFirst({ where: { organizationId, meetingId: id, writerId: viewer.id }, select: { text: true } });
    if (!notes?.text.trim()) throw new MeetingRefusal('MEETING_AI_NO_NOTES');

    const targets = (await this.itemsToDraft(id, organizationId)).slice(0, ITEMS_PER_CALL);
    if (targets.length === 0) throw new MeetingRefusal('MEETING_AI_NOTHING_TO_DRAFT');

    const [names, loaded, meeting] = await Promise.all([
      this.nameTable(id, organizationId),
      this.calendar.loadCalendar(organizationId),
      this.prisma.meeting.findFirst({ where: { id, organizationId }, select: { scheduledAt: true } }),
    ]);
    if (!meeting) throw new MeetingRefusal('MEETING_CHANGED');
    const zone = loaded.calendar.timezone;
    const input = {
      notes: names.replace(notes.text),
      items: targets.map((t) => ({
        ...t,
        title: names.replace(t.title),
        description: t.description ? names.replace(t.description) : null,
        existingActions: t.existingActions.map((a) => names.replace(a)),
      })),
      meetingDay: DateTime.fromJSDate(meeting.scheduledAt).setZone(zone).toISODate()!,
      today: DateTime.fromJSDate(now).setZone(zone).toISODate()!,
    };
    if (minutesInputTokens(language, input) > AI_FEATURES.minutes_drafting.inputTokenCap!) {
      throw new MeetingRefusal('MEETING_AI_TOO_LONG', { feature: 'minutes' });
    }

    const claimedAt = await this.claim(id, organizationId, viewer.id, now);
    if (!claimedAt) throw new MeetingRefusal('MEETING_AI_IN_PROGRESS');
    let done = false;
    try {
      const sent = new Map<string, DraftParts>(input.items.map((t) => [t.label, t.parts]));
      let nothing = false;
      let result;
      try {
        result = await this.ai.run(
          MINUTES_FEATURE,
          { organizationId, actorId: viewer.id },
          {
            system: minutesSystemPrompt(language),
            prompt: minutesPrompt(input),
            // Ids and counts only: never the notes, a title or a name.
            description: `Meeting ${id} minutes draft, ${input.items.length} item(s), notes ${notes.text.length} characters`,
            accept: (content, truncated) => {
              if (truncated) return false;
              const parsed = parseMinutesAnswer(content, sent);
              nothing = parsed.kind === 'nothing';
              return parsed.kind === 'draft';
            },
          },
        );
      } catch (error) {
        // The gateway has refunded it. "Nothing in these notes" has its own words.
        if (nothing && error instanceof AiRefusalException && error.code === 'AI_PROVIDER_FAILED') throw new MeetingRefusal('MEETING_AI_NOTHING_SUGGESTED');
        throw error;
      }
      const parsed = parseMinutesAnswer(result.content, sent);
      if (parsed.kind !== 'draft') throw new AiRefusalException('AI_PROVIDER_FAILED');

      const byLabel = new Map(targets.map((t) => [t.label, t]));
      const rows: { agendaItemId: string; kind: 'ITEM_MINUTES' | 'ACTION_ITEM'; order: number; payload: MinutesPayload | ActionPayload }[] = [];
      const ownerNames = await this.ownerNames(parsed.items.flatMap((i) => i.actions), names, organizationId);
      for (const item of parsed.items) {
        const target = byLabel.get(item.label)!;
        if (item.minutes) {
          rows.push({
            agendaItemId: target.agendaItemId,
            kind: 'ITEM_MINUTES',
            order: 0,
            payload: item.nothing
              ? { nothing: true, discussion: null, decisions: [] }
              : {
                  nothing: false,
                  discussion: item.minutes.discussion === null ? null : names.writeBack(item.minutes.discussion),
                  decisions: item.minutes.decisions.map((d) => ({ text: names.writeBack(d.text), votes: d.votes })),
                },
          });
        }
        item.actions.forEach((action, i) => {
          rows.push({
            agendaItemId: target.agendaItemId,
            kind: 'ACTION_ITEM',
            order: i + 1,
            payload: this.actionPayload(action, names, ownerNames, zone, loaded.calendar.workingHoursEnd, now),
          });
        });
      }

      await this.saveRun(id, organizationId, viewer, now, targets, rows, language, result.interactionId);
      done = true;
    } finally {
      await this.release(id, organizationId, claimedAt, done, now);
    }
    return this.getAi(id, organizationId, viewer, now);
  }

  // ── Accept and discard ──────────────────────────────────────────────────────

  async accept(id: string, suggestionId: string, dto: AcceptMeetingAiDto, organizationId: string, viewer: MeetingViewer, now: Date = new Date()): Promise<IMeetingAiAccepted> {
    await this.assertRecorderOf(id, organizationId, viewer, now);
    const row = await this.prisma.meetingAiSuggestion.findFirst({
      where: { id: suggestionId, organizationId, meetingId: id, kind: { in: ['ITEM_MINUTES', 'ACTION_ITEM'] } },
      select: { kind: true, agendaItemId: true, payload: true, aiInteractionId: true },
    });
    if (!row || !row.agendaItemId) throw new MeetingRefusal('MEETING_AI_SUGGESTION_GONE');

    let draft: AiDraftWrite;
    if (row.kind === 'ITEM_MINUTES') {
      const p = row.payload as unknown as MinutesPayload;
      if (p.nothing) throw new MeetingRefusal('MEETING_AI_NOT_OFFERED');
      draft = { kind: 'ITEM_MINUTES', agendaItemId: row.agendaItemId, discussion: p.discussion, decisions: p.decisions };
    } else {
      const p = row.payload as unknown as ActionPayload;
      draft = {
        kind: 'ACTION_ITEM',
        agendaItemId: row.agendaItemId,
        title: dto.title !== undefined ? dto.title : p.title,
        ownerUserId: dto.ownerUserId ?? p.owner?.userId ?? null,
        dueAt: dto.dueAt ?? p.dueAt,
      };
    }
    const kind = row.kind === 'ITEM_MINUTES' ? 'ITEM_MINUTES' : 'ACTION_ITEM';
    const minutes = await this.minutes.applyAiDraft(
      id,
      draft,
      { kind, interactionId: row.aiInteractionId },
      async (tx) => {
        const taken = await tx.meetingAiSuggestion.deleteMany({ where: { id: suggestionId, organizationId, meetingId: id } });
        if (taken.count === 0) throw new MeetingRefusal('MEETING_AI_SUGGESTION_GONE');
      },
      organizationId,
      viewer,
      now,
    );
    return { minutes, ai: await this.getAi(id, organizationId, viewer, now) };
  }

  async discard(id: string, suggestionId: string, organizationId: string, viewer: MeetingViewer, now: Date = new Date()): Promise<IMeetingAi> {
    await this.assertRecorderOf(id, organizationId, viewer, now);
    const removed = await this.prisma.meetingAiSuggestion.deleteMany({ where: { id: suggestionId, organizationId, meetingId: id } });
    if (removed.count === 0) throw new MeetingRefusal('MEETING_AI_SUGGESTION_GONE');
    return this.getAi(id, organizationId, viewer, now);
  }

  // ── Who, and where ──────────────────────────────────────────────────────────

  private isRecorder(owner: MeetingOwner, organizationId: string, viewerId: string, now: Date): Promise<boolean> {
    return isMeetingKindMember(this.prisma, organizationId, owner, 'MEETING_RECORDERS', viewerId, now);
  }

  /** The meeting's own 404 first, then whoever records the minutes. */
  private async assertRecorderOf(id: string, organizationId: string, viewer: MeetingViewer, now: Date): Promise<void> {
    const owner = await this.access.seeing(id, organizationId, viewer, now);
    if (!(await this.isRecorder(owner, organizationId, viewer.id, now))) throw new MeetingRefusal('MEETING_NOT_RECORDER');
  }

  /** Draft minutes' gate (§1.2): the person, then the stage, the phase and M9. */
  private async assertMayDraftMinutes(id: string, organizationId: string, viewer: MeetingViewer, now: Date): Promise<void> {
    await this.assertRecorderOf(id, organizationId, viewer, now);
    const gate = await this.minutesGate(id, organizationId);
    if (!gate.offered) throw new MeetingRefusal('MEETING_AI_NOT_OFFERED', { stageNameEn: gate.rules.stageNameEn, stageNameAr: gate.rules.stageNameAr });
  }

  /**
   * Whether the minutes are a draft (suggestions are shown), and whether Draft
   * minutes is offered: the stage allows `record_minutes` and the meeting was
   * never returned (M9: Return leaves `reviewRound` at its round, so a returned
   * meeting in Minutes Draft has a round of 1 or more). Read with `client`, so
   * the save re-reads it under its own locks.
   */
  private async minutesGate(
    id: string,
    organizationId: string,
    client: EngineTx | PrismaService = this.prisma,
    rules?: StageRules,
  ): Promise<{ rules: StageRules; draft: boolean; offered: boolean }> {
    const [stage, meeting] = await Promise.all([
      rules ? Promise.resolve(rules) : this.stageRules.currentStageRules('MEETING', id, organizationId),
      client.meeting.findFirst({ where: { id, organizationId }, select: { reviewRound: true } }),
    ]);
    const draft = minutesPhase(stage) === 'draft' && stage.actions[MEETING_ACTIONS.RECORD_MINUTES] === true;
    return { rules: stage, draft, offered: draft && meeting?.reviewRound === 0 };
  }

  // ── What a press drafts (M8) ────────────────────────────────────────────────

  /**
   * The items a press drafts, in agenda order, each with its parts. The FIRST
   * press (no finished run yet) drafts every item, both parts. Afterwards an
   * item's minutes are drafted again only when it has no discussion and no
   * decision, or an undecided minutes suggestion; its actions when it has an
   * undecided action suggestion or its minutes are drafted. Anything else is
   * left out.
   */
  private async itemsToDraft(id: string, organizationId: string): Promise<DraftTarget[]> {
    const [items, undecided, run] = await Promise.all([
      this.prisma.agendaItem.findMany({
        where: { organizationId, meetingId: id },
        orderBy: { order: 'asc' },
        select: {
          id: true,
          title: true,
          description: true,
          discussion: true,
          _count: { select: { decisions: true } },
          actionItems: { where: { organizationId }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], select: { title: true } },
        },
      }),
      this.prisma.meetingAiSuggestion.findMany({
        where: { organizationId, meetingId: id, kind: { in: ['ITEM_MINUTES', 'ACTION_ITEM'] } },
        select: { agendaItemId: true, kind: true },
      }),
      this.prisma.meetingAiRun.findFirst({ where: { organizationId, meetingId: id, kind: 'MINUTES' }, select: { lastDoneAt: true } }),
    ]);
    const first = !run?.lastDoneAt;
    const has = (itemId: string, kind: 'ITEM_MINUTES' | 'ACTION_ITEM') => undecided.some((u) => u.agendaItemId === itemId && u.kind === kind);
    const out: DraftTarget[] = [];
    for (const item of items) {
      let parts: DraftParts | null;
      if (first) parts = 'both';
      else {
        const minutes = (!item.discussion && item._count.decisions === 0) || has(item.id, 'ITEM_MINUTES');
        parts = minutes ? 'both' : has(item.id, 'ACTION_ITEM') ? 'actions' : null;
      }
      if (!parts) continue;
      out.push({
        label: `A${out.length + 1}`,
        agendaItemId: item.id,
        title: item.title,
        description: item.description,
        parts,
        existingActions: item.actionItems.map((a) => a.title),
      });
    }
    return out;
  }

  // ── Names ───────────────────────────────────────────────────────────────────

  /** The meeting's invitees and the organisation's ACTIVE people: two reads, whatever the meeting's size. */
  private async nameTable(id: string, organizationId: string): Promise<NameTable> {
    const [attendees, people] = await Promise.all([
      this.prisma.meetingAttendee.findMany({
        where: { organizationId, meetingId: id },
        select: { kind: true, userId: true, outsideName: true, user: { select: { name: true, status: true } } },
      }),
      this.prisma.user.findMany({ where: { organizationId, status: 'ACTIVE' }, select: { id: true, name: true } }),
    ]);
    const invitees: NameSource[] = attendees.map((a) => ({
      kind: a.kind,
      userId: a.userId,
      name: a.user?.name ?? a.outsideName ?? '',
      active: a.user?.status === 'ACTIVE',
    }));
    return new NameTable(invitees, people.map((p) => ({ userId: p.id, name: p.name })));
  }

  /** The owners' names as stored on their user rows, for the suggestions (one read). */
  private async ownerNames(actions: readonly ParsedAction[], names: NameTable, organizationId: string): Promise<Map<string, string>> {
    const ids = [...new Set(actions.map((a) => names.person(a.owner)?.userId).filter((x): x is string => !!x))];
    if (ids.length === 0) return new Map();
    const users = await this.prisma.user.findMany({ where: { organizationId, id: { in: ids } }, select: { id: true, name: true } });
    return new Map(users.map((u) => [u.id, u.name]));
  }

  /** An action as stored: the owner resolved from its label exactly (M7), the due date in the organisation's zone. */
  private actionPayload(
    action: ParsedAction,
    names: NameTable,
    ownerNames: ReadonlyMap<string, string>,
    zone: string,
    workingHoursEnd: string,
    now: Date,
  ): ActionPayload {
    const person = names.person(action.owner);
    let owner: ActionPayload['owner'] = null;
    let ownerReason: IMeetingAiOwnerReason = null;
    if (person?.kind === 'OUTSIDE_GUEST') ownerReason = { code: 'OUTSIDE_GUEST', name: person.name };
    else if (person?.userId && person.active) owner = { userId: person.userId, name: ownerNames.get(person.userId) ?? person.name };
    else if (person) ownerReason = { code: 'NO_MATCH', name: person.name };
    else if (action.owner && !/^\[?P\d+\]?$/.test(action.owner)) ownerReason = { code: 'NO_MATCH', name: action.owner.slice(0, 60) };
    else if (action.ownerName) ownerReason = { code: 'NO_MATCH', name: action.ownerName };
    const due = dueInstant(action.due, action.time, zone, workingHoursEnd, now);
    return { title: names.writeBack(action.what), owner, ownerReason, dueAt: due.dueAt?.toISOString() ?? null, dueReason: due.reason };
  }

  // ── The save ────────────────────────────────────────────────────────────────

  /**
   * ONE transaction under the minutes' lock order: the instance FOR SHARE (the
   * stage's rules), then the meeting row FOR UPDATE. It re-checks the stage and
   * M9 there: a meeting that moved on during the call saves nothing
   * (MEETING_CHANGED; the call was paid for and stays charged). Draft again
   * replaces only the undecided suggestions of the parts it drafted; an item
   * deleted during the call is skipped.
   */
  private async saveRun(
    id: string,
    organizationId: string,
    viewer: MeetingViewer,
    now: Date,
    targets: readonly DraftTarget[],
    rows: readonly { agendaItemId: string; kind: 'ITEM_MINUTES' | 'ACTION_ITEM'; order: number; payload: MinutesPayload | ActionPayload }[],
    language: MinutesLanguage,
    interactionId: string | null,
  ): Promise<void> {
    // The person, live: someone who stopped recording the minutes during the call saves nothing.
    const owner = await this.access.seeing(id, organizationId, viewer, now);
    if (!(await this.isRecorder(owner, organizationId, viewer.id, now))) throw new MeetingRefusal('MEETING_CHANGED');
    await this.prisma
      .$transaction(async (tx) => {
        const rules = await this.stageRules.currentStageRules('MEETING', id, organizationId, tx, { lock: 'share' });
        await lockMeetingRow(tx, id, organizationId);
        const gate = await this.minutesGate(id, organizationId, tx, rules);
        if (!gate.offered) throw new MeetingRefusal('MEETING_CHANGED');
        const live = new Set(
          (await tx.agendaItem.findMany({ where: { organizationId, meetingId: id, id: { in: targets.map((t) => t.agendaItemId) } }, select: { id: true } })).map((i) => i.id),
        );
        for (const t of targets) {
          if (!live.has(t.agendaItemId)) continue;
          await tx.meetingAiSuggestion.deleteMany({
            where: { organizationId, meetingId: id, agendaItemId: t.agendaItemId, kind: { in: t.parts === 'both' ? ['ITEM_MINUTES', 'ACTION_ITEM'] : ['ACTION_ITEM'] } },
          });
        }
        const keep = rows.filter((r) => live.has(r.agendaItemId));
        if (keep.length > 0) {
          await tx.meetingAiSuggestion.createMany({
            data: keep.map((r) => ({
              organizationId,
              meetingId: id,
              agendaItemId: r.agendaItemId,
              kind: r.kind,
              order: r.order,
              language,
              payload: r.payload as never,
              aiInteractionId: interactionId,
              createdById: viewer.id,
            })),
          });
        }
      })
      .catch((error: unknown) => asMeetingConflict(error));
  }

  // ── One run at a time ───────────────────────────────────────────────────────

  /** Takes the meeting's Draft minutes claim, or null when a live one is held. Returns the claim's own time. */
  private async claim(id: string, organizationId: string, viewerId: string, now: Date): Promise<Date | null> {
    const staleBefore = new Date(now.getTime() - MEETING_AI_CLAIM_STALE_MS);
    const rows = await this.prisma.$queryRaw<{ meetingId: string }[]>`
      INSERT INTO "MeetingAiRun" ("organizationId", "meetingId", "kind", "claimedById", "claimedAt")
      VALUES (${organizationId}, ${id}, 'MINUTES'::"MeetingAiRunKind", ${viewerId}, ${now})
      ON CONFLICT ("meetingId", "kind") DO UPDATE SET "claimedById" = EXCLUDED."claimedById", "claimedAt" = EXCLUDED."claimedAt"
      WHERE "MeetingAiRun"."organizationId" = EXCLUDED."organizationId"
        AND ("MeetingAiRun"."claimedAt" IS NULL OR "MeetingAiRun"."claimedAt" < ${staleBefore})
      RETURNING "meetingId"`;
    return rows.length === 1 ? now : null;
  }

  /** Releases our own claim only, never a later run's; a finished run stamps lastDoneAt (the first-press rule). Never throws. */
  private async release(id: string, organizationId: string, claimedAt: Date, done: boolean, now: Date): Promise<void> {
    try {
      await this.prisma.meetingAiRun.updateMany({
        where: { organizationId, meetingId: id, kind: 'MINUTES', claimedAt },
        data: { claimedById: null, claimedAt: null, ...(done && { lastDoneAt: now }) },
      });
    } catch (error) {
      // Ids and the error's kind only, never its message (ACC-297's rule).
      this.logger.error(`Could not release the minutes AI claim on meeting ${id} (org ${organizationId}): ${(error as Error).name}`);
    }
  }
}
