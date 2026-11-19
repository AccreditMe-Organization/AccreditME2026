import { Logger } from '@nestjs/common';
import type { NotificationService } from '../notification/notification.service';
import type { OutsideEmailText } from '../notification/outside-email';
import type { NoticeText } from './meeting-notices';

/**
 * ACC-316 — how a meeting tells people, in ONE place: the effects, the
 * reschedule, the guest and agenda writes and the invitee sync all send
 * through these. Each send is on its own: one that fails is logged by the
 * error's kind (never its message) and the rest still go. Never inside a
 * transaction: callers send after they commit.
 */
const logger = new Logger('MeetingSend');

type Sender = Pick<NotificationService, 'create' | 'sendOutsideEmail'>;

/** In the app and by email, to each user — never the actor. */
export async function notifyUsers(
  notifications: Sender,
  organizationId: string,
  meetingId: string,
  actorId: string | null,
  userIds: readonly string[],
  text: NoticeText,
  channel: 'BOTH' | 'IN_APP' = 'BOTH',
): Promise<void> {
  for (const userId of new Set(userIds)) {
    if (userId === actorId) continue;
    try {
      await notifications.create({ userId, ...text, channel, objectType: 'MEETING', objectId: meetingId }, organizationId);
    } catch (error) {
      logger.warn(`A meeting notice failed for meeting ${meetingId} in org ${organizationId}: ${error instanceof Error ? error.name : 'unknown'}`);
    }
  }
}

/** By email only, to each outside guest's address, in the organisation's language. */
export async function emailOutsideGuests(
  notifications: Sender,
  organizationId: string,
  meetingId: string,
  addresses: readonly string[],
  text: OutsideEmailText,
): Promise<void> {
  for (const to of new Set(addresses)) {
    try {
      await notifications.sendOutsideEmail(organizationId, to, text);
    } catch (error) {
      logger.warn(`An outside guest's email failed for meeting ${meetingId} in org ${organizationId}: ${error instanceof Error ? error.name : 'unknown'}`);
    }
  }
}

/** The organisation's name in each language, for an outside guest's email (Arabic falls back to the English). */
export interface OrganisationNames {
  en: string;
  ar: string;
}

export function organisationNames(org: { name: string; nameAr: string | null } | null): OrganisationNames {
  return { en: org?.name ?? '', ar: org?.nameAr ?? org?.name ?? '' };
}
