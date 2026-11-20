import { Component } from '@angular/core';
import { preserveDocumentLanguage } from '../../../../../testing/document-language';
import { useLayoutFonts } from '../../../../../testing/layout-fonts';
import { CAP, DialogLayout, ROOM, WIDTHS } from '../../meeting-dialog-layout.testing';
import type { WorkflowMoveDto } from '../../../workflow/services/workflow.service';
import type { MoveBlock } from '../../../workflow/components/workflow-transition-actions/workflow-transition-actions.component';
import { MeetingCantApproveDialogComponent } from './meeting-cant-approve-dialog.component';

// ACC-316 PR 7c-2 — "Can't move to Minutes Approved yet" against the 420px body
// cap (ACC-111), MEASURED in both languages at 1280 and on a 390 phone, in its
// two tallest states: a review waiting on ten people, and ten action items past
// their due date with long titles, each listing six then "and 4 more" (the
// cap is what keeps an unbounded list under 420). Each keeps 20px.
// NON-VACUITY FIRST (ACC-120): a body that measured 0 would pass.

const APPROVE: WorkflowMoveDto = {
  id: 't-approve',
  labelEn: 'Approve Minutes',
  labelAr: 'اعتماد المحضر',
  kind: 'ADVANCE',
  toStageId: 's-approved',
  toStageNameEn: 'Minutes Approved',
  toStageNameAr: 'المحضر معتمد',
};
const NAMES = [
  'Dr. Nora Al-Otaibi',
  'Huda Al-Harbi',
  'Dr. Sara Al-Qahtani',
  'Eng. Saad Al-Dosari',
  'Fatima Al-Zahrani',
  'Dr. Abdulrahman Al-Qahtani',
  'Maha Al-Shehri',
  'Dr. Khalid Al-Mutairi',
  'Reem Al-Dossary',
  'Dr. Faisal Al-Ghamdi',
];
const REVIEW: MoveBlock = { code: 'MEETING_REVIEW_OPEN', reviewBy: '2026-11-10', waitingFor: NAMES.map((name, i) => ({ userId: `u-${i}`, name })) };
const PAST_DUE: MoveBlock = {
  code: 'MEETING_ACTION_PAST_DUE',
  items: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => ({
    id: `a-${n}`,
    title: 'Replace the isolation room air filter and record the pressure readings for the infection control log',
    agendaItemOrder: n,
    dueAt: '2026-11-02T09:00:00.000Z',
  })),
};

@Component({
  standalone: true,
  imports: [MeetingCantApproveDialogComponent],
  template: `<app-meeting-cant-approve-dialog [visible]="true" [refusal]="refusal" context="Infection Prevention & Control · 24 Sep · Minutes Review" />`,
})
class Host {
  refusal: { move: WorkflowMoveDto; blockedBy: MoveBlock } = { move: APPROVE, blockedBy: REVIEW };
}

describe("Can't move to Minutes Approved yet — layout, measured (ACC-316 PR 7c-2)", () => {
  useLayoutFonts({ rtl: true });
  preserveDocumentLanguage();
  const layout = new DialogLayout<Host>();

  afterAll(() => console.log(`ACC-316 cant-approve dialog (cap ${CAP}, room ≥ ${ROOM}):\n  ${layout.measured.join('\n  ')}`));
  afterEach(() => layout.destroy());

  for (const language of ['en', 'ar'] as const) {
    for (const width of WIDTHS) {
      it(`[${language}, ${width}]: a review waiting on ten people, and ten action items past due`, async () => {
        await layout.open(Host, language, width, {});
        expect(document.querySelectorAll('[data-testid="cant-approve-lines"] li').length).withContext('six names').toBe(6);
        expect(document.querySelector('[data-testid="cant-approve-more"]')).withContext('and 4 more').not.toBeNull();
        layout.check('review open, ten waiting', language, width, 420);
        layout.destroy();

        await layout.open(Host, language, width, {}, (h) => (h.refusal = { move: APPROVE, blockedBy: PAST_DUE }));
        expect(document.querySelectorAll('[data-testid="cant-approve-lines"] li').length).withContext('six items').toBe(6);
        expect(document.querySelector('[data-testid="cant-approve-more"]')).withContext('and 4 more').not.toBeNull();
        layout.check('ten action items past due', language, width, 420);
      }, 60_000);
    }
  }
});
