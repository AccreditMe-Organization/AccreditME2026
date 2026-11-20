import type { MeetingAttendanceRowDto, MeetingAttendeeDto, MeetingDto, MeetingMinutesDto, MeetingMinutesItemDto } from './services/meeting.service';

/**
 * ACC-316 PR 6 — a meeting as the server answers GET /meetings/:id, for the
 * meeting screens' specs. Test support only. A committee's meeting in Planned,
 * which the viewer may edit, reschedule and add guests to, and answer.
 */
export function aMeeting(overrides: Partial<MeetingDto> = {}): MeetingDto {
  return {
    id: 'm-1',
    title: 'Quarterly review of high-alert medication incidents',
    scheduledAt: '2027-03-18T10:30:00.000Z',
    durationMinutes: 90,
    location: 'Board room, Tower B, floor 3',
    meetingUrl: null,
    owner: { kind: 'COMMITTEE', id: 'c-1', nameEn: 'Pharmacy and Therapeutics Committee', nameAr: 'لجنة الصيدلة والعلاجات' },
    stage: { id: 's-planned', nameEn: 'Planned', nameAr: 'مجدول', flags: [] },
    type: { id: 't-1', labelEn: 'Regular', labelAr: 'اعتيادي' },
    unitQuorum: null,
    organizer: { id: 'u-sec', name: 'Huda Al-Harbi' },
    rescheduledFrom: null,
    updatedAt: '2027-03-01T08:00:00.000Z',
    may: { edit: true, reschedule: true, manageGuests: true, manageAgenda: true, answer: true },
    answers: { members: 8, attending: 5, cantAttend: 2, noAnswer: 1, quorum: 5, belowQuorum: false },
    myAnswer: { answer: null, note: null },
    ...overrides,
  };
}

export function anAttendee(overrides: Partial<MeetingAttendeeDto> = {}): MeetingAttendeeDto {
  return {
    id: 'a-1',
    kind: 'MEMBER',
    userId: 'u-1',
    name: 'Dr. Nora Al-Otaibi',
    seat: { id: 'seat-chair', labelEn: 'Chairman', labelAr: 'رئيس اللجنة' },
    outsideOrganisation: null,
    outsideRole: null,
    outsideEmail: null,
    answer: null,
    answerNote: null,
    invited: true,
    addedAsPresenter: false,
    ...overrides,
  };
}

/** ACC-316 PR 7b — one invitee's attendance row: a member, nothing recorded. */
export function anAttendanceRow(overrides: Partial<MeetingAttendanceRowDto> = {}): MeetingAttendanceRowDto {
  return {
    attendeeId: 'a-1',
    kind: 'MEMBER',
    userId: 'u-1',
    name: 'Dr. Nora Al-Otaibi',
    seat: { id: 'seat-chair', labelEn: 'Chairman', labelAr: 'رئيس اللجنة' },
    attendance: null,
    suggested: null,
    ...overrides,
  };
}

export function aMinutesItem(overrides: Partial<MeetingMinutesItemDto> = {}): MeetingMinutesItemDto {
  return { id: 'i-1', order: 1, title: 'Isolation room maintenance', standing: false, discussion: null, decisions: [], actionItems: [], ...overrides };
}

/**
 * ACC-316 PR 7b — the minutes as GET /meetings/:id/minutes answers them, in
 * Minutes Draft, for whoever records them: two members and a guest invited,
 * nothing recorded yet, the quorum 2.
 */
export function aMinutes(overrides: Partial<MeetingMinutesDto> = {}): MeetingMinutesDto {
  return {
    phase: 'draft',
    attendance: [
      anAttendanceRow(),
      anAttendanceRow({ attendeeId: 'a-2', userId: 'u-2', name: 'Huda Al-Harbi', seat: { id: 'seat-sec', labelEn: 'Secretary', labelAr: 'أمين السر' } }),
      anAttendanceRow({ attendeeId: 'a-3', kind: 'ORG_GUEST', userId: 'u-3', name: 'Eng. Saad Al-Dosari', seat: null }),
    ],
    quorum: { quorum: 2, presentMembers: 0, met: false },
    items: [aMinutesItem()],
    openActions: [],
    review: { round: 0, reviewBy: null, datePassed: false, closed: false, reviewers: [], suggestions: [], changes: [], mine: null },
    distribute: { ready: false, blockedBy: { code: 'MEETING_ATTENDANCE_INCOMPLETE', missing: [{ attendeeId: 'a-1', name: 'Dr. Nora Al-Otaibi' }] }, defaultReviewBy: '2027-03-25' },
    approvedAt: null,
    approvedBy: null,
    may: { recordAttendance: true, recordMinutes: true, distribute: true, returnForCorrection: false, review: false, applySuggestions: false, changeActionDates: false },
    ...overrides,
  };
}
