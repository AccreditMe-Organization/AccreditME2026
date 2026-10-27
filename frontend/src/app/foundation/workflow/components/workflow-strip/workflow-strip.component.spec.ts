import { Component, input } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TranslateService, provideTranslateService } from '@ngx-translate/core';
import en from '../../../../../assets/i18n/en.json';
import ar from '../../../../../assets/i18n/ar.json';
import { loadTranslationsForTest, provideFormatTesting } from '../../../../core/formatting/testing';
import { LanguageService } from '../../../../core/services/language.service';
import { preserveDocumentLanguage } from '../../../../../testing/document-language';
import { WorkflowStageDto, WorkflowTransitionDto } from '../../services/workflow-template.service';
import { WorkflowStripComponent } from './workflow-strip.component';

// ACC-255 PR 4b — the flow strip (Templates 6b): GENERATED from the stages and
// their transitions, never authored. Cards are buttons in stage order, each
// with the server's liveCount and the names of its exits; between two cards,
// the forward transitions are solid and the returns dashed; the strip scrolls
// sideways inside its own frame, never the page.

const transition = (over: Partial<WorkflowTransitionDto>): WorkflowTransitionDto => ({
  id: 't',
  fromStageId: '',
  toStageId: '',
  labelEn: '',
  labelAr: null,
  requiredPermission: null,
  triggerCondition: 'ROLE_BASED',
  triggerUserId: null,
  triggerRoleId: null,
  validatorConfig: null,
  isApprovalPath: false,
  kind: 'ADVANCE',
  ...over,
});

const stage = (id: string, nameEn: string, nameAr: string | null, liveCount: number, transitions: WorkflowTransitionDto[]): WorkflowStageDto =>
  ({ id, nameEn, nameAr, liveCount, transitions, order: 0, actions: [], flags: [] }) as unknown as WorkflowStageDto;

const STAGES: WorkflowStageDto[] = [
  stage('s1', 'Formation', 'التشكيل', 3, [transition({ id: 'a', fromStageId: 's1', toStageId: 's2', labelEn: 'Submit Terms', labelAr: 'تقديم الشروط' })]),
  stage('s2', 'Terms Review', 'مراجعة الشروط', 0, [
    transition({ id: 'b', fromStageId: 's2', toStageId: 's3', labelEn: 'Approve Committee', labelAr: 'اعتماد اللجنة' }),
    transition({ id: 'c', fromStageId: 's2', toStageId: 's1', labelEn: 'Revise Terms', labelAr: 'تعديل الشروط', kind: 'RETURN' }),
    // Back to the previous stage, but not a return: named on the card only.
    transition({ id: 'e', fromStageId: 's2', toStageId: 's1', labelEn: 'Withdraw', labelAr: 'سحب', kind: 'EXIT' }),
  ]),
  stage('s3', 'Active', 'نشطة', 2, [
    // To a stage that is not the next one: named on the card only.
    transition({ id: 'd', fromStageId: 's3', toStageId: 's4', labelEn: 'Dissolve', labelAr: 'حل' }),
  ]),
  stage('s4', 'Dissolved', 'محلولة', 1, []),
];

@Component({
  standalone: true,
  imports: [WorkflowStripComponent],
  template: `<div data-host [style.width.px]="width()"><am-workflow-strip [stages]="stages" selectedId="s2" (opened)="opened = $event.stageId" /></div>`,
})
class Host {
  readonly width = input(1148);
  stages = STAGES;
  opened: string | null = null;
}

describe('WorkflowStripComponent (ACC-255 PR 4b)', () => {
  preserveDocumentLanguage();
  let fixture: ComponentFixture<Host>;

  function render(lang: 'en' | 'ar', width = 1148): HTMLElement {
    TestBed.configureTestingModule({ imports: [Host], providers: [provideTranslateService({ lang }), provideFormatTesting()] });
    loadTranslationsForTest({ en, ar });
    TestBed.inject(TranslateService).use(lang);
    TestBed.inject(LanguageService).use(lang);
    fixture = TestBed.createComponent(Host);
    fixture.componentRef.setInput('width', width);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  const texts = (el: HTMLElement, sel: string): string[] =>
    Array.from(el.querySelectorAll<HTMLElement>(sel)).map((n) => n.textContent!.replace(/\s+/g, ' ').trim());

  it('draws one button per stage, in order, with its live count and its exits', () => {
    const el = render('en');
    const cards = el.querySelectorAll<HTMLButtonElement>('[data-strip-card]');
    expect(cards.length).toBe(4);
    expect(Array.from(cards).every((c) => c.tagName === 'BUTTON')).toBeTrue();
    expect(texts(el, '[data-strip-name]')).toEqual(['Formation', 'Terms Review', 'Active', 'Dissolved']);
    expect(texts(el, '[data-strip-live]')).toEqual(['3 records here now', '0 records here now', '2 records here now', '1 record here now']);
    expect(texts(el, '[data-strip-exits]')).toEqual(['Submit Terms', 'Approve Committee · Revise Terms · Withdraw', 'Dissolve', 'No exits']);
  });

  it('draws forward transitions to the next stage solid, returns dashed, and nothing else between cards', () => {
    const el = render('en');
    const conns = Array.from(el.querySelectorAll<HTMLElement>('[data-strip-conn]'));
    expect(conns.length).toBe(3);
    const describe = (c: HTMLElement) => ({
      forward: texts(c, '.am-strip__label:not(.am-strip__label--back)'),
      back: texts(c, '.am-strip__label--back'),
      dashed: c.querySelectorAll('.am-strip__line--back').length,
    });
    expect(conns.map(describe)).toEqual([
      { forward: ['Submit Terms'], back: ['Revise Terms'], dashed: 1 },
      { forward: ['Approve Committee'], back: [], dashed: 0 },
      { forward: ['Dissolve'], back: [], dashed: 0 },
    ]);
  });

  it('reads in Arabic, right to left, with Latin digits and every plural form', () => {
    const el = render('ar');
    expect(getComputedStyle(el.querySelector('.am-strip__row')!).direction).toBe('rtl');
    expect(texts(el, '[data-strip-name]')).toEqual(['التشكيل', 'مراجعة الشروط', 'نشطة', 'محلولة']);
    expect(texts(el, '[data-strip-live]')).toEqual(['3 سجلات هنا الآن', 'لا سجلات هنا الآن', 'سجلان هنا الآن', 'سجل واحد هنا الآن']);
    expect(texts(el, '[data-strip-exits]')[3]).toBe('لا مخارج');
    // The first card is on the right.
    const cards = el.querySelectorAll<HTMLElement>('[data-strip-card]');
    expect(cards[0]!.getBoundingClientRect().left).toBeGreaterThan(cards[1]!.getBoundingClientRect().left);
  });

  it('marks the open stage, and a press opens its stage', () => {
    const el = render('en');
    const cards = el.querySelectorAll<HTMLButtonElement>('[data-strip-card]');
    expect(Array.from(cards).map((c) => c.getAttribute('aria-current'))).toEqual([null, 'true', null, null]);
    cards[2]!.click();
    expect(fixture.componentInstance.opened).toBe('s3');
  });

  it('scrolls sideways inside its own frame on a phone, never the page, and never vertically', () => {
    const el = render('en', 358);
    const frame = el.querySelector<HTMLElement>('[data-strip-frame]')!;
    // Non-vacuity: four cards and three connectors are wider than 358.
    expect(frame.scrollWidth).toBeGreaterThan(frame.clientWidth);
    expect(getComputedStyle(frame).overflowX).toBe('auto');
    expect(getComputedStyle(frame).overflowY).toBe('hidden');
    expect(frame.getBoundingClientRect().width).toBeLessThanOrEqual(358 + 1);
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(document.documentElement.clientWidth);
  });
});
