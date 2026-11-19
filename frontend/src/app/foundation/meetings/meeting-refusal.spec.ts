import { HttpErrorResponse } from '@angular/common/http';
import en from '../../../assets/i18n/en.json';
import ar from '../../../assets/i18n/ar.json';
import { MEETING_REFUSAL_KEYS, meetingRefusalKey } from './meeting-refusal';

// ACC-316 PR 6 — every meeting refusal the screens say has its sentence in both
// languages, and an unknown code falls back to the screen's own words (never
// the server's English).
describe('meeting refusals (ACC-316 PR 6)', () => {
  const lookup = (doc: unknown, key: string): unknown => key.split('.').reduce<unknown>((o, k) => (o as Record<string, unknown> | undefined)?.[k], doc);

  for (const [code, key] of Object.entries(MEETING_REFUSAL_KEYS)) {
    it(`${code} is said in English and Arabic`, () => {
      expect(typeof lookup(en, key)).withContext(`en ${key}`).toBe('string');
      expect(typeof lookup(ar, key)).withContext(`ar ${key}`).toBe('string');
    });
  }

  it('reads the code off the refusal', () => {
    expect(meetingRefusalKey(new HttpErrorResponse({ status: 409, error: { code: 'MEETING_CHANGED', message: 'Meeting changed' } }))).toBe('meeting.refusal.changed');
  });

  it('a code it does not know, or none, is null', () => {
    expect(meetingRefusalKey(new HttpErrorResponse({ status: 400, error: { code: 'SOMETHING_ELSE' } }))).toBeNull();
    expect(meetingRefusalKey(new HttpErrorResponse({ status: 500, error: { message: 'boom' } }))).toBeNull();
  });
});
