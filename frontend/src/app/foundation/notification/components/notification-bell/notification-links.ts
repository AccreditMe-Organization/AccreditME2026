import { NotificationDto } from '../../services/notification.service';

/**
 * ACC-228 — every task notification carries the task (objectType 'Task').
 * ACC-271 PR 4 — a closed-task notice carries its record, for a reader who
 * may open it (the server leaves it out for anyone else): a committee.
 */
export function notificationLink(item: NotificationDto): string[] | null {
  if (!item.objectId) return null;
  if (item.objectType === 'Task') return ['/tasks', item.objectId];
  if (item.objectType === 'COMMITTEE') return ['/committees', item.objectId];
  return null;
}

/** ACC-271 PR 4 — a closed-task notice opens the record it is about. */
export function isNotificationRecordLink(item: NotificationDto): boolean {
  return item.objectType === 'COMMITTEE' && !!item.objectId;
}
