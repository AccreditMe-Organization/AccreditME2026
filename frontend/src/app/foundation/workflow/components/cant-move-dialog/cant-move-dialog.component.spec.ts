import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { provideRouter } from '@angular/router';
import { TranslateService, provideTranslateService } from '@ngx-translate/core';
import { ConfirmationService } from 'primeng/api';
import en from '../../../../../assets/i18n/en.json';
import ar from '../../../../../assets/i18n/ar.json';
import { loadTranslationsForTest, provideFormatTesting } from '../../../../core/formatting/testing';
import { preserveDocumentLanguage } from '../../../../../testing/document-language';
import { OpenStageTask } from '../../workflow-refusal';
import { CantMoveDialogComponent } from './cant-move-dialog.component';

// ACC-208 — "Can't move yet" (drawing section 3.2): each open mandatory task
// as a link to its row, with who has it (or the pool it waits in), its due
// date, Mandatory and the evidence rule; Close only.

const TASKS: OpenStageTask[] = [
  {
    id: 'task-held',
    title: 'Interview the staff involved',
    titleAr: 'مقابلة الموظفين المعنيين',
    status: 'IN_PROGRESS',
    statusLabel: 'In progress',
    dueAt: '2026-10-14T10:00:00.000Z',
    requiresEvidence: true,
    assignees: [{ id: 'u-1', name: 'Nora Al-Otaibi' }],
    pool: {
      kind: 'POSITION',
      orgUnit: { nameEn: 'Cardiology', nameAr: 'أمراض القلب' },
      position: { nameEn: 'Quality Officer', nameAr: 'مسؤول الجودة' },
    },
  },
  {
    id: 'task-pool',
    title: 'Inform the committee',
    titleAr: null,
    status: 'PENDING',
    statusLabel: 'Assigned',
    dueAt: null,
    requiresEvidence: false,
    assignees: [],
    pool: {
      kind: 'COMMITTEE_ROLE',
      committee: { nameEn: 'Quality Assurance Committee', nameAr: null },
      role: { labelEn: 'Secretary', labelAr: 'أمين السر' },
    },
  },
  {
    id: 'task-nobody',
    title: 'Collect the records',
    titleAr: null,
    status: 'UNASSIGNED',
    statusLabel: 'Unassigned',
    dueAt: null,
    requiresEvidence: false,
    assignees: [],
    pool: null,
  },
];

@Component({
  standalone: true,
  imports: [CantMoveDialogComponent],
  template: `
    <app-cant-move-dialog
      [visible]="visible()"
      [tasks]="tasks"
      title="Can't move to Active yet"
      lead="Finish these tasks before moving to Active:"
      context="Quality Assurance Committee · Terms Review"
      openedFrom="Approve"
      (closed)="closes = closes + 1; visible.set(false)"
    />
  `,
})
class HostComponent {
  readonly visible = signal(true);
  readonly tasks = TASKS;
  closes = 0;
}

describe('CantMoveDialogComponent (ACC-208)', () => {
  preserveDocumentLanguage();

  let fixture: ComponentFixture<HostComponent>;

  async function setup(language: 'en' | 'ar' = 'en'): Promise<HTMLElement> {
    TestBed.configureTestingModule({
      imports: [HostComponent],
      providers: [
        provideNoopAnimations(),
        provideRouter([]),
        provideTranslateService({ lang: 'en' }),
        provideFormatTesting(),
        ConfirmationService,
      ],
    });
    loadTranslationsForTest({ en, ar });
    TestBed.inject(TranslateService).use(language);
    fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    const dialog = document.querySelector<HTMLElement>('.p-dialog');
    expect(dialog).withContext('the dialog did not open').not.toBeNull();
    return dialog!;
  }

  const rows = (dialog: HTMLElement) =>
    Array.from(dialog.querySelectorAll('[data-cant-move-task]')).map((row) => ({
      link: row.querySelector('a')?.textContent?.trim(),
      href: row.querySelector('a')?.getAttribute('href'),
      meta: row.querySelector('.am-cant-move__meta')?.textContent?.trim(),
    }));

  it('lists each task as a link to its row, with who, when, Mandatory and the evidence rule', async () => {
    const dialog = await setup();
    const text = dialog.textContent?.replace(/\s+/g, ' ') ?? '';
    expect(text).toContain("Can't move to Active yet");
    expect(text).toContain('Quality Assurance Committee · Terms Review');
    expect(text).toContain('Finish these tasks before moving to Active:');
    expect(text).toContain('Opened from “Approve”');

    const [held, pool, nobody] = rows(dialog);
    expect(held.link).toBe('Interview the staff involved');
    expect(held.href).toBe('/?task=task-held');
    expect(held.meta).toMatch(/^Nora Al-Otaibi \(Quality Officer, Cardiology\) · due 14 Oct 2026, \d\d:\d\d · Mandatory · evidence required$/);
    expect(pool.meta).toBe('Waiting for Secretary of the Quality Assurance Committee · no due date · Mandatory');
    expect(nobody.meta).toBe('Nobody yet · no due date · Mandatory');
  });

  it('closes from Close and from following a link', async () => {
    const dialog = await setup();
    (dialog.querySelector('[data-cant-move-close] button') as HTMLButtonElement).click();
    expect(fixture.componentInstance.closes).toBe(1);

    fixture.componentInstance.visible.set(true);
    fixture.detectChanges();
    await fixture.whenStable();
    (document.querySelector('[data-cant-move-task] a') as HTMLAnchorElement).click();
    expect(fixture.componentInstance.closes).toBe(2);
  });

  it('speaks Arabic: Arabic names lead, English is the fallback', async () => {
    const dialog = await setup('ar');
    const [held, pool] = rows(dialog);
    expect(held.link).toBe('مقابلة الموظفين المعنيين');
    expect(held.meta).toContain('Nora Al-Otaibi (مسؤول الجودة، أمراض القلب)');
    expect(held.meta).toContain('الدليل مطلوب');
    expect(pool.link).toBe('Inform the committee');
    expect(pool.meta).toContain('بانتظار أمين السر في Quality Assurance Committee');
  });
});
