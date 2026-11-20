import { TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { TranslateService, provideTranslateService } from '@ngx-translate/core';
import { ConfirmationService } from 'primeng/api';
import { providePrimeNG } from 'primeng/config';
import en from '../../../../../assets/i18n/en.json';
import ar from '../../../../../assets/i18n/ar.json';
import { loadTranslationsForTest, provideFormatTesting } from '../../../../core/formatting/testing';
import { preserveDocumentLanguage } from '../../../../../testing/document-language';
import type { WorkflowMoveDto } from '../../../workflow/services/workflow.service';
import type { MoveBlock } from '../../../workflow/components/workflow-transition-actions/workflow-transition-actions.component';
import { MEETING_APPROVAL_BLOCKS, MeetingCantApproveDialogComponent } from './meeting-cant-approve-dialog.component';

// ACC-316 PR 7c-2 — "Can't move to Minutes Approved yet": the one thing that
// holds Approve Minutes, said from its code with its details; Close only.
describe('MeetingCantApproveDialogComponent (ACC-316 PR 7c-2)', () => {
  preserveDocumentLanguage();

  const APPROVE: WorkflowMoveDto = {
    id: 't-approve',
    labelEn: 'Approve Minutes',
    labelAr: 'اعتماد المحضر',
    kind: 'ADVANCE',
    toStageId: 's-approved',
    toStageNameEn: 'Minutes Approved',
    toStageNameAr: 'المحضر معتمد',
  };
  const ITEMS = [
    { id: 'a-1', title: 'Replace the isolation room filter', agendaItemOrder: 4, dueAt: '2026-11-02T09:00:00.000Z' },
    { id: 'a-2', title: 'Audit the hand-hygiene stations', agendaItemOrder: null, dueAt: '2026-11-03T09:00:00.000Z' },
  ];

  function create(blockedBy: MoveBlock, language: 'en' | 'ar' = 'en') {
    TestBed.configureTestingModule({ providers: [provideNoopAnimations(), provideTranslateService({ lang: 'en' }), provideFormatTesting(), providePrimeNG({}), ConfirmationService] });
    loadTranslationsForTest({ en, ar });
    TestBed.inject(TranslateService).use(language);
    const fixture = TestBed.createComponent(MeetingCantApproveDialogComponent);
    fixture.componentRef.setInput('refusal', { move: APPROVE, blockedBy });
    fixture.componentRef.setInput('context', 'Infection Control · March · Minutes Review');
    fixture.componentRef.setInput('visible', true);
    fixture.detectChanges();
    return { fixture, c: fixture.componentInstance };
  }

  const q = (id: string) => document.querySelector(`[data-testid="${id}"]`);
  const text = (id: string) => q(id)?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
  afterEach(() => document.querySelectorAll('.p-dialog-mask, .p-dialog').forEach((n) => n.remove()));

  it('explains exactly the codes the server sends for Approve Minutes', () => {
    expect([...MEETING_APPROVAL_BLOCKS].sort()).toEqual(['MEETING_ACTION_PAST_DUE', 'MEETING_ACTION_PAST_SLA_LIMIT', 'MEETING_REVIEW_OPEN', 'MEETING_SUGGESTION_OPEN']);
  });

  it('names the stage in the title and the move in the footer', () => {
    const { c } = create({ code: 'MEETING_SUGGESTION_OPEN', open: 1 });
    expect(c.stageName()).toBe('Minutes Approved');
    expect(c.openedFrom()).toBe('Approve Minutes');
    expect(document.querySelector('.p-dialog')?.textContent).toContain("Can't move to Minutes Approved yet");
  });

  it('the review still open: until when, and who has yet to answer', () => {
    create({ code: 'MEETING_REVIEW_OPEN', reviewBy: '2026-11-10', waitingFor: [{ userId: 'u-1', name: 'Dr. Nora Al-Otaibi' }, { userId: 'u-2', name: 'Huda Al-Harbi' }] });
    expect(text('cant-approve-lead')).toBe('The review is open until 10 Nov 2026. Still to answer:');
    expect(Array.from(document.querySelectorAll('[data-testid="cant-approve-lines"] li')).map((li) => li.textContent!.trim())).toEqual(['Dr. Nora Al-Otaibi', 'Huda Al-Harbi']);
  });

  it('lists six, then "and n more", so an unbounded list stays under the cap', () => {
    const waitingFor = Array.from({ length: 9 }, (_, i) => ({ userId: `u-${i}`, name: `Member ${i + 1}` }));
    create({ code: 'MEETING_REVIEW_OPEN', reviewBy: null, waitingFor });
    expect(document.querySelectorAll('[data-testid="cant-approve-lines"] li').length).toBe(6);
    expect(text('cant-approve-more')).toBe('and 3 more');
  });

  it('no "more" line when every line shows', () => {
    create({ code: 'MEETING_ACTION_PAST_DUE', items: ITEMS });
    expect(q('cant-approve-more')).toBeNull();
  });

  it('the review open with no date', () => {
    create({ code: 'MEETING_REVIEW_OPEN', reviewBy: null, waitingFor: [{ userId: 'u-1', name: 'Dr. Nora Al-Otaibi' }] });
    expect(text('cant-approve-lead')).toBe('The review is still open. Still to answer:');
  });

  it('suggestions still open, counted', () => {
    create({ code: 'MEETING_SUGGESTION_OPEN', open: 2 });
    expect(text('cant-approve-lead')).toBe('2 suggestions are still open. Apply or decline each first.');
    expect(q('cant-approve-lines')).toBeNull();
  });

  it('action items past due: each named, with its item and due date', () => {
    create({ code: 'MEETING_ACTION_PAST_DUE', items: ITEMS });
    expect(text('cant-approve-lead')).toBe('These 2 action items are past their due date. Change the dates first:');
    const lines = Array.from(document.querySelectorAll('[data-testid="cant-approve-lines"] li')).map((li) => li.textContent!.trim());
    // The due date before the title, so a cut title never hides it.
    expect(lines[0]).toMatch(/^Item 4 · due .+ · Replace the isolation room filter$/);
    expect(lines[1]).toMatch(/^Due .+ · Audit the hand-hygiene stations$/);
  });

  it('action items past the latest a task may be due: the limit named', () => {
    create({ code: 'MEETING_ACTION_PAST_SLA_LIMIT', items: [ITEMS[0]!], limit: '2026-12-01T09:00:00.000Z' });
    expect(text('cant-approve-lead')).toContain('This action item is due after');
    expect(text('cant-approve-lead')).toContain('the latest a task may be due');
  });

  it('keeps what it says while it closes, so the text does not blank', () => {
    const { fixture, c } = create({ code: 'MEETING_SUGGESTION_OPEN', open: 1 });
    const before = c.lead();
    fixture.componentRef.setInput('visible', false);
    fixture.componentRef.setInput('refusal', null);
    fixture.detectChanges();
    expect(c.lead()).toBe(before);
    expect(c.stageName()).toBe('Minutes Approved');
  });

  it('in Arabic: the stage and the counted sentence', () => {
    const { c } = create({ code: 'MEETING_SUGGESTION_OPEN', open: 2 }, 'ar');
    expect(c.stageName()).toBe('المحضر معتمد');
    expect(c.lead()).toBe('ما زال اقتراحان مفتوحين. طبّق كلًّا منهما أو ارفضه أولًا.');
  });
});
