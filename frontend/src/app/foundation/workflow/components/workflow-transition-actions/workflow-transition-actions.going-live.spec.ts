import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { provideRouter } from '@angular/router';
import { TranslateService, provideTranslateService } from '@ngx-translate/core';
import { ConfirmationService } from 'primeng/api';
import en from '../../../../../assets/i18n/en.json';
import ar from '../../../../../assets/i18n/ar.json';
import { environment } from '../../../../../environments/environment';
import { loadTranslationsForTest, provideFormatTesting } from '../../../../core/formatting/testing';
import { LanguageService } from '../../../../core/services/language.service';
import { preserveDocumentLanguage } from '../../../../../testing/document-language';
import { WorkflowInstanceDto, WorkflowMoveDto } from '../../services/workflow.service';
import { WorkflowTransitionActionsComponent } from './workflow-transition-actions.component';

// ACC-286 — a committee refused going live (Terms Review → Active), said on the
// record page's move buttons from its code, in both languages: the numbers
// against the quorum through the plural object, or the empty required seats by
// their own names in the reader's language. Never the server's English. Read
// from the REAL translation files.

const INSTANCE: WorkflowInstanceDto = {
  id: 'instance-1',
  organizationId: 'org-a',
  workflowTemplateId: 'template-1',
  objectType: 'COMMITTEE',
  objectId: 'committee-1',
  status: 'IN_PROGRESS',
  currentStageId: 'stage-terms',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  unassignedTaskWarnings: [],
};
const APPROVE: WorkflowMoveDto = {
  id: 'transition-approve',
  labelEn: 'Approve Committee',
  labelAr: 'اعتماد اللجنة',
  kind: 'ADVANCE',
  toStageId: 'stage-active',
  toStageNameEn: 'Active',
  toStageNameAr: 'نشطة',
};
const BAIT = 'English for a log';

describe('the move buttons say why a committee cannot go live (ACC-286)', () => {
  preserveDocumentLanguage();
  let http: HttpTestingController;
  let fixture: ComponentFixture<WorkflowTransitionActionsComponent>;

  function setup(lang: 'en' | 'ar'): void {
    TestBed.configureTestingModule({
      imports: [WorkflowTransitionActionsComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideNoopAnimations(),
        provideRouter([]),
        provideTranslateService({ lang }),
        provideFormatTesting(),
        ConfirmationService,
      ],
    });
    loadTranslationsForTest({ en, ar });
    TestBed.inject(TranslateService).use(lang);
    TestBed.inject(LanguageService).use(lang);
    http = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(WorkflowTransitionActionsComponent);
    fixture.componentRef.setInput('instance', INSTANCE);
    fixture.detectChanges();
    http.expectOne(`${environment.apiUrl}/workflows/instances/instance-1/moves`).flush({ transitionIds: [APPROVE.id], moves: [APPROVE] });
    fixture.detectChanges();
  }

  function refuse(body: Record<string, unknown>): string {
    fixture.componentInstance.onTrigger(APPROVE);
    http
      .expectOne(`${environment.apiUrl}/workflows/instances/instance-1/transitions`)
      .flush({ statusCode: 409, error: 'Conflict', message: BAIT, ...body }, { status: 409, statusText: 'Conflict' });
    fixture.detectChanges();
    return (fixture.nativeElement as HTMLElement).textContent ?? '';
  }

  afterEach(() => {
    http.verify();
    TestBed.resetTestingModule();
  });

  const SEATS = [
    { id: 'seat-chair', labelEn: 'Chairman', labelAr: 'رئيس اللجنة' },
    { id: 'seat-sec', labelEn: 'Secretary', labelAr: 'أمين السر' },
  ];

  for (const [lang, belowQuorum, seatsEmpty] of [
    [
      'en',
      'Add members first: the quorum needs 3 members, and this committee has 2.',
      'Fill the required seats first: Chairman, Secretary.',
    ],
    [
      'ar',
      'يلزم إضافة أعضاء أولاً: عدد الأعضاء الذي يتطلبه النصاب 3، وعدد أعضاء اللجنة 2.',
      'يلزم شغل المقاعد المطلوبة أولاً: رئيس اللجنة، أمين السر.',
    ],
  ] as const) {
    describe(`[${lang}]`, () => {
      it('fewer members than the quorum: both numbers, through the plural object', () => {
        setup(lang);
        const text = refuse({ code: 'COMMITTEE_MEMBERS_BELOW_QUORUM', quorum: 3, members: 2 });
        expect(text).toContain(belowQuorum);
        expect(text).not.toContain(BAIT);
        expect(text).not.toContain('workflow.');
      });

      it('empty required seats: named in the reader\'s language, joined as the language joins a list', () => {
        setup(lang);
        const text = refuse({ code: 'COMMITTEE_REQUIRED_SEATS_EMPTY', seats: SEATS });
        expect(text).toContain(seatsEmpty);
        expect(text).not.toContain(BAIT);
      });

      it('a seat with no Arabic name is named in English, never left blank', () => {
        setup(lang);
        const text = refuse({ code: 'COMMITTEE_REQUIRED_SEATS_EMPTY', seats: [{ id: 'own', labelEn: 'Rapporteur', labelAr: null }] });
        expect(text).toContain('Rapporteur');
      });
    });
  }

  it('a body it cannot read still says the plain sentence, never the server English', () => {
    setup('en');
    expect(refuse({ code: 'COMMITTEE_REQUIRED_SEATS_EMPTY' })).toContain("Fill the committee's required seats first.");
    TestBed.resetTestingModule();
    setup('en');
    expect(refuse({ code: 'COMMITTEE_MEMBERS_BELOW_QUORUM' })).toContain('Add members first: this committee has fewer members than its quorum.');
  });
});
