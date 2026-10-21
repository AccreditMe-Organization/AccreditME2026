import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { ObjectVisibilityService } from '../../common/services/object-visibility.service';
import { AiService } from '../ai/ai.service';
import { AiRefusalException } from '../ai/ai-refusal';
import { aiFeatureAvailability } from '../ai/ai-availability';
import {
  DraftLanguage,
  NOTE_MIN_LETTERS,
  countLetters,
  draftDescription,
  draftLines,
  draftPrompt,
  draftSystemPrompt,
  parseDraftAnswer,
} from './draft-answer';
import { assertMayCreateTasks, seesRecordType } from '../task/task-record-types';
import { draftRecordContext } from './draft-record-context';
import { DraftRefusalException } from './draft-refusal';
import { ITaskDraft, ITaskDraftAvailability } from './interfaces/task-draft.interface';

export const DRAFT_FEATURE = 'task_description_drafting';

export interface DraftViewer {
  id: string;
  permissions: readonly string[];
}

export interface DraftRequest {
  note: string;
  language: DraftLanguage;
  /** The Title field, if anything is typed. */
  title?: string | null;
  /** The record the task is about — both, or neither. */
  sourceType?: string | null;
  sourceId?: string | null;
}

/**
 * ACC-197 — AI drafts a task description from a short note. Plan:
 * backend/Plans/step-197-task-drafting.md.
 *
 * NOTHING IS STORED. A draft goes back to the New task dialog, the person
 * accepts, edits or discards it, and a task exists only when they press Create
 * task (POST /tasks, unchanged). The only row this writes is the gateway's AI
 * log row — counts, never the note or the answer.
 *
 * draft(), in order:
 *   1. The note has a few words — else DRAFT_NOTE_TOO_SHORT. No call, no charge.
 *   2. With a record: the viewer may SEE it (ObjectVisibilityService, 403
 *      naming the permission BEFORE any read; 404 for a record that is not
 *      theirs). The record's own words shape the answer, so this is the same
 *      entitlement as opening it (ACC-101).
 *   3. AI is available for the organisation — else the gateway's AI_NOT_ENABLED.
 *   4. The record's context: type, name, a committee's purpose (Q2). Never a
 *      person's name.
 *   5. The gateway, with accept(): an answer we cannot use is refunded.
 *      "The note does not say what the task is" → DRAFT_NOTHING_TO_SUGGEST.
 */
@Injectable()
export class TaskDraftService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ai: AiService,
    private readonly objectVisibility: ObjectVisibilityService,
  ) {}

  /**
   * Whether to show "Draft with AI" at all. Says nothing about the balance: a
   * press answers "used up". ACC-244 — gated like New task: Create tasks on at
   * least one record type.
   */
  async availability(organizationId: string, permissions: readonly string[]): Promise<ITaskDraftAvailability> {
    assertMayCreateTasks(permissions);
    const { available } = await aiFeatureAvailability(this.prisma, organizationId, DRAFT_FEATURE);
    return { available };
  }

  async draft(viewer: DraftViewer, organizationId: string, request: DraftRequest): Promise<ITaskDraft> {
    const sourceType = request.sourceType || null;
    const sourceId = request.sourceId || null;
    // ACC-244 — gated like New task, before anything else: Create tasks on the
    // named record's type (a type the caller cannot see is assertCanView's 403
    // below, which names the record's permission), or on any type with none.
    if (!sourceType) assertMayCreateTasks(viewer.permissions);
    else if (seesRecordType(viewer.permissions, sourceType)) assertMayCreateTasks(viewer.permissions, sourceType);

    const note = request.note.trim();
    if (countLetters(note) < NOTE_MIN_LETTERS) throw new DraftRefusalException('DRAFT_NOTE_TOO_SHORT');

    if (!sourceType !== !sourceId) throw new BadRequestException('sourceType and sourceId go together');
    if (sourceType && sourceId) {
      await this.objectVisibility.assertCanView(sourceType, sourceId, organizationId, viewer.permissions);
    }

    const availability = await aiFeatureAvailability(this.prisma, organizationId, DRAFT_FEATURE);
    if (!availability.available) {
      throw new AiRefusalException('AI_NOT_ENABLED', { reason: availability.reason, feature: DRAFT_FEATURE });
    }

    const record = sourceType && sourceId ? await draftRecordContext(this.prisma, sourceType, sourceId, organizationId, request.language) : null;

    let insufficient = false;
    let result;
    try {
      result = await this.ai.run(
        DRAFT_FEATURE,
        { organizationId, actorId: viewer.id },
        {
          system: draftSystemPrompt(request.language),
          prompt: draftPrompt({ note, title: request.title, record }),
          // Counts and ids only: never the note, the title or the record's name.
          description: `task draft · ${sourceType && sourceId ? `${sourceType} ${sourceId}` : 'no record'} · note ${note.length} characters`,
          accept: (content, truncated) => {
            if (truncated) return false;
            const parsed = parseDraftAnswer(content, request.title);
            insufficient = parsed.kind === 'insufficient';
            return parsed.kind === 'draft';
          },
        },
      );
    } catch (error) {
      // The gateway has already refunded it. "Nothing to suggest" gets its own
      // words; any other unusable answer stays the gateway's "try again".
      if (insufficient && error instanceof AiRefusalException && error.code === 'AI_PROVIDER_FAILED') {
        throw new DraftRefusalException('DRAFT_NOTHING_TO_SUGGEST');
      }
      throw error;
    }

    const parsed = parseDraftAnswer(result.content, request.title);
    // accept() let it through, so it is a draft; the guard is for the type.
    if (parsed.kind !== 'draft') throw new AiRefusalException('AI_PROVIDER_FAILED');
    const lines = draftLines(parsed, request.language);
    return { draftId: result.interactionId, title: parsed.title, lines, description: draftDescription(lines) };
  }
}
