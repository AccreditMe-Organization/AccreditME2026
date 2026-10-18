import { Type } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { TranslateService, provideTranslateService } from '@ngx-translate/core';
import { ConfirmationService } from 'primeng/api';
import { providePrimeNG } from 'primeng/config';
import en from '../../../../assets/i18n/en.json';
import ar from '../../../../assets/i18n/ar.json';
import { FormatService } from '../../../core/formatting';
import { loadTranslationsForTest, provideFormatTesting } from '../../../core/formatting/testing';
import { preserveDocumentLanguage } from '../../../../testing/document-language';
import { AmConfirmOptions, AmConfirmService } from './am-confirm.service';
import { LookupValueListComponent } from '../../../foundation/lookup/components/lookup-value-list/lookup-value-list.component';
import { PositionListComponent } from '../../../foundation/org-position/components/position-list/position-list.component';
import { OrgUnitHeadPanelComponent } from '../../../foundation/organization/components/org-unit-head-panel/org-unit-head-panel.component';
import { RoleListComponent } from '../../../foundation/roles/components/role-list/role-list.component';
import { UserStatusActionsService } from '../../../foundation/user/services/user-status-actions.service';
import { WorkflowActionConfiguratorComponent } from '../../../foundation/workflow/components/workflow-action-configurator/workflow-action-configurator.component';
import { WorkflowStageListComponent } from '../../../foundation/workflow/components/workflow-stage-list/workflow-stage-list.component';
import { WorkflowTemplateListComponent } from '../../../foundation/workflow/components/workflow-template-list/workflow-template-list.component';
import { WorkflowTransitionEditorComponent } from '../../../foundation/workflow/components/workflow-transition-editor/workflow-transition-editor.component';
import { TenantListComponent } from '../../../platform/components/tenant-list/tenant-list.component';
import { NavigationAccessService } from '../../../core/services/navigation-access.service';

/**
 * ACC-120 slice 10, PR 2 — every confirm says what it acts on and what happens
 * next, in both languages, read from the REAL translation files.
 *
 * Each case calls the component's own handler and reads what it passed to
 * AmConfirmService.ask(): the header (the question), the message (the
 * consequence) and the action's verb. The consequences were checked against the
 * server code (the PR body names each file and line); this pins the words, so a
 * reworded key or a dropped parameter turns red here.
 */

type Lang = 'en' | 'ar';
interface Said {
  header: string;
  message: string;
  accept: string;
  reject?: string;
}

describe('the confirms\' words (ACC-120 slice 10, PR 2)', () => {
  preserveDocumentLanguage();

  let asked: AmConfirmOptions[];

  function setup(lang: Lang, extra: unknown[] = []): void {
    asked = [];
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        provideTranslateService({ lang }),
        providePrimeNG({}),
        provideFormatTesting(),
        ConfirmationService,
        { provide: AmConfirmService, useValue: { ask: (o: AmConfirmOptions) => asked.push(o) } },
        ...(extra as never[]),
      ],
    });
    loadTranslationsForTest({ en, ar });
    TestBed.inject(TranslateService).use(lang);
  }

  function create<T>(type: Type<T>, inputs: Record<string, unknown> = {}): T {
    const fixture = TestBed.createComponent(type);
    for (const [name, value] of Object.entries(inputs)) fixture.componentRef.setInput(name, value);
    return fixture.componentInstance;
  }

  function said(): Said {
    expect(asked.length).withContext('the handler asked exactly once').toBe(1);
    const o = asked[0];
    return { header: o.header, message: o.message, accept: o.acceptLabel, ...(o.rejectLabel ? { reject: o.rejectLabel } : {}) };
  }

  const both = (name: string, run: (lang: Lang) => void): void => {
    for (const lang of ['en', 'ar'] as const) {
      it(`${name} — ${lang === 'en' ? 'English' : 'Arabic'}`, () => {
        setup(lang);
        run(lang);
      });
    }
  };

  // ── #3 Delete value ─────────────────────────────────────────────────────────
  both('#3 Delete value names the value and keeps it on old records', (lang) => {
    create(LookupValueListComponent).onDelete({
      id: 'v1', key: 'urgent', labelEn: 'Urgent', labelAr: 'عاجل', labelOverrideEn: null, labelOverrideAr: null,
    } as never);
    expect(said()).toEqual(
      lang === 'en'
        ? { header: 'Delete the value “Urgent”?', message: "It's no longer offered in lists. Records that already use it keep it.", accept: 'Delete value' }
        : { header: 'حذف القيمة «عاجل»؟', message: 'لن تُعرض في القوائم بعد الآن، والسجلات التي تستخدمها تبقى عليها.', accept: 'حذف القيمة' },
    );
  });

  // ── #4 Deactivate position ──────────────────────────────────────────────────
  both('#4 Deactivate position, an ordinary one, in the session\'s language', (lang) => {
    create(PositionListComponent).onDeactivate({
      id: 'p1', nameEn: 'Charge Nurse', nameAr: 'ممرضة مسؤولة', isUnitHeadPosition: false,
    } as never);
    expect(said()).toEqual(
      lang === 'en'
        ? { header: 'Deactivate the position “Charge Nurse”?', message: 'Nobody new can be given it, and whoever holds it now keeps it.', accept: 'Deactivate' }
        : { header: 'تعطيل المنصب «ممرضة مسؤولة»؟', message: 'لا يمكن منحه لأحد جديد، ومن يحمله الآن يبقى عليه.', accept: 'إلغاء التفعيل' },
    );
  });

  both('#4 a Head position says its holders stop counting as Head; no Arabic name falls back to English', (lang) => {
    create(PositionListComponent).onDeactivate({
      id: 'p2', nameEn: 'Head of Unit', nameAr: null, isUnitHeadPosition: true,
    } as never);
    expect(said()).toEqual(
      lang === 'en'
        ? {
            header: 'Deactivate the position “Head of Unit”?',
            message: 'Nobody new can be given it. Whoever holds it now keeps it, but no longer counts as the Head of their unit.',
            accept: 'Deactivate',
          }
        : {
            header: 'تعطيل المنصب «Head of Unit»؟',
            message: 'لا يمكن منحه لأحد جديد. ومن يحمله الآن يبقى عليه، لكنه لا يُعدّ بعد الآن رئيسًا لوحدته.',
            accept: 'إلغاء التفعيل',
          },
    );
  });

  // ── #5, #6, #7 the Head panel ───────────────────────────────────────────────
  function headPanel(lang: Lang, status: unknown): OrgUnitHeadPanelComponent {
    const panel = create(OrgUnitHeadPanelComponent, {
      orgUnitId: 'u1',
      unitName: lang === 'en' ? 'Cardiology' : 'أمراض القلب',
    });
    panel.status.set(status as never);
    return panel;
  }

  both('#5 Vacate Head names the unit and the Head', (lang) => {
    headPanel(lang, {
      holders: [{ id: 'h1', name: 'Sara Ali', positionId: 'pos' }],
      pendingHeadUserId: null, headHandoverEffectiveDate: null, actingHeadUserId: null,
    }).onVacate();
    expect(said()).toEqual(
      lang === 'en'
        ? {
            header: 'Vacate the Head of Cardiology?',
            message: 'Sara Ali no longer holds the Head position, and loses any role it gives them. Cardiology has no Head until one is assigned.',
            accept: 'Vacate Head',
          }
        : {
            header: 'إخلاء رئاسة أمراض القلب؟',
            message: 'لن يشغل Sara Ali منصب الرئيس بعد الآن، وسيفقد أي دور يمنحه إياه. وتبقى أمراض القلب بلا رئيس حتى يُعيَّن رئيس.',
            accept: 'إخلاء منصب الرئيس',
          },
    );
  });

  both('#6 Cancel handover names both people, and Cancel reads Keep handover', (lang) => {
    headPanel(lang, {
      holders: [
        { id: 'h1', name: 'Sara Ali', positionId: 'pos' },
        { id: 'h2', name: 'Omar Saleh', positionId: 'pos' },
      ],
      pendingHeadUserId: 'h2', headHandoverEffectiveDate: '2026-10-20', actingHeadUserId: null,
    }).onCancelHandover();
    expect(said()).toEqual(
      lang === 'en'
        ? {
            header: 'Cancel the handover to Omar Saleh?',
            message: 'Omar Saleh no longer holds the Head position, and any role it gave them is removed. Sara Ali stays the Head.',
            accept: 'Cancel Handover',
            reject: 'Keep handover',
          }
        : {
            header: 'إلغاء التسليم إلى Omar Saleh؟',
            message: 'لن يشغل Omar Saleh منصب الرئيس، ويُزال أي دور منحه إياه. ويبقى Sara Ali الرئيس.',
            accept: 'إلغاء التسليم والتسلّم',
            reject: 'إبقاء التسليم والتسلّم',
          },
    );
  });

  both('#7 End cover says the unit has no Head and where its work goes', (lang) => {
    headPanel(lang, {
      holders: [], pendingHeadUserId: null, headHandoverEffectiveDate: null, actingHeadUserId: 'x1',
    }).onClearActingHead();
    expect(said()).toEqual(
      lang === 'en'
        ? {
            header: 'End the Acting Head cover for Cardiology?',
            message:
              'The cover ends now, and the Acting Head loses any role it gave them. Cardiology has no Head again, so work meant for its Head goes to the Head of the unit above it, if there is one.',
            accept: 'End cover',
          }
        : {
            header: 'إنهاء تغطية الرئيس بالنيابة في أمراض القلب؟',
            message:
              'تنتهي التغطية الآن، ويفقد الرئيس بالنيابة أي دور منحته إياه. وتعود أمراض القلب بلا رئيس، فيذهب ما يخص رئيسها إلى رئيس الوحدة الأعلى منها إن وُجدت.',
            accept: 'إنهاء التغطية',
          },
    );
  });

  // ── #8 Deactivate role ──────────────────────────────────────────────────────
  function deactivateRole(holders: number | undefined): Said {
    create(RoleListComponent).onDeactivate({ id: 'r1', nameEn: 'Auditor', nameAr: 'مدقق', activeHolderCount: holders } as never);
    return said();
  }

  both('#8 Deactivate role counts the people who lose it', (lang) => {
    expect(deactivateRole(3)).toEqual(
      lang === 'en'
        ? {
            header: 'Deactivate the role “Auditor”?',
            message: '3 people hold it and lose its permissions now. The role stays assigned, so reactivating it gives those permissions back.',
            accept: 'Deactivate Role',
          }
        : {
            header: 'تعطيل الدور «مدقق»؟',
            message: 'يحمله 3 أشخاص سيفقدون صلاحيات الدور الآن. ويبقى الدور مُسندًا كما هو، فإعادة تفعيله تعيد صلاحياته.',
            accept: 'إلغاء تفعيل الدور',
          },
    );
  });

  both('#8 with one holder, the singular', (lang) => {
    expect(deactivateRole(1).message).toBe(
      lang === 'en'
        ? '1 person holds it and loses its permissions now. The role stays assigned, so reactivating it gives those permissions back.'
        : 'يحمله شخص واحد سيفقد صلاحيات الدور الآن. ويبقى الدور مُسندًا كما هو، فإعادة تفعيله تعيد صلاحياته.',
    );
  });

  both('#8 with nobody holding it, says so plainly and never "0 people"', (lang) => {
    const message = deactivateRole(0).message;
    expect(message).toBe(
      lang === 'en'
        ? 'Nobody holds it now, so nobody loses anything. You can reactivate it later.'
        : 'لا أحد يحمله الآن، فلن يفقد أحد شيئًا. ويمكنك إعادة تفعيله لاحقًا.',
    );
    expect(message).not.toContain('0');
  });

  it('#8 the Arabic plural has its own form for 0, 1, 2, 3, 11 and 100', () => {
    setup('ar');
    const format = TestBed.inject(FormatService);
    const forms = [0, 1, 2, 3, 11, 100].map((n) => format.count('role.deactivateHolders', n));
    expect(forms).toEqual([
      'لا أحد يحمله الآن.',
      'يحمله شخص واحد سيفقد صلاحيات الدور الآن.',
      'يحمله شخصان سيفقدان صلاحيات الدور الآن.',
      'يحمله 3 أشخاص سيفقدون صلاحيات الدور الآن.',
      'يحمله 11 شخصًا سيفقدون صلاحيات الدور الآن.',
      'يحمله 100 شخص سيفقدون صلاحيات الدور الآن.',
    ]);
    // Six different sentences, so a missing form cannot hide behind "other".
    expect(new Set(forms).size).toBe(6);
  });

  it('#8 the English plural has one and other', () => {
    setup('en');
    const format = TestBed.inject(FormatService);
    expect(format.count('role.deactivateHolders', 1)).toBe('1 person holds it and loses its permissions now.');
    expect(format.count('role.deactivateHolders', 2)).toBe('2 people hold it and lose its permissions now.');
  });

  // ── #14, #15, #16 the user status actions ───────────────────────────────────
  const result = { succeeded: () => undefined, failed: () => undefined };
  const user = { id: 'u9', name: 'Nora Al-Otaibi', email: 'nora@example.test', status: 'ACTIVE' } as never;

  both('#14 Deactivate user says what happens to sessions and to each kind of task', (lang) => {
    TestBed.inject(UserStatusActionsService).confirmDeactivate(user, result);
    expect(said()).toEqual(
      lang === 'en'
        ? {
            header: 'Deactivate Nora Al-Otaibi?',
            message:
              "They're signed out at once and can't sign in. A task from a pool goes back to it, unless someone else is still on it. Their other tasks go to their acting user if they have one; otherwise a task nobody else is on is left unassigned for you to reassign.\n\nYou can reactivate them later, and they come back with the roles they have now.",
            accept: 'Deactivate',
          }
        : {
            header: 'إلغاء تنشيط Nora Al-Otaibi؟',
            message:
              'تُنهى جلساته فورًا ولن يتمكن من تسجيل الدخول. تعود مهمة المجموعة إلى مجموعتها، ما لم يكن شخص آخر يعمل عليها. وتنتقل مهامه الأخرى إلى المستخدم البديل إن وُجد، وإلا تبقى المهمة التي لا يعمل عليها غيره بلا مُسنَد إليه لتعيد إسنادها.\n\nيمكنك إعادة تنشيطه لاحقًا، وسيعود بالأدوار التي لديه الآن.',
            accept: 'إلغاء التفعيل',
          },
    );
  });

  both('#15 Reactivate user names them, their roles, and which tasks come back', (lang) => {
    TestBed.inject(UserStatusActionsService).confirmReactivate(user, result);
    TestBed.inject(HttpTestingController)
      .match(() => true)
      .forEach((r) => r.flush([{ role: { nameEn: 'Auditor', nameAr: 'مدقق' } }]));
    expect(said()).toEqual(
      lang === 'en'
        ? {
            header: 'Reactivate Nora Al-Otaibi?',
            message:
              'They can sign in again, and take up one of your seats.\n\nThey come back holding: Auditor.\n\nTasks left unassigned when they left come back to them. Tasks that went to someone else, or back to a pool, stay where they are.',
            accept: 'Reactivate',
          }
        : {
            header: 'إعادة تنشيط Nora Al-Otaibi؟',
            message:
              'سيتمكن من تسجيل الدخول مجددًا، وسيشغل أحد مقاعدكم.\n\nسيعود وهو يحمل: مدقق.\n\nتعود إليه المهام التي بقيت بلا مُسنَد إليه بعد مغادرته. أما المهام التي انتقلت إلى شخص آخر أو عادت إلى مجموعتها فتبقى حيث هي.',
            accept: 'إعادة التنشيط',
          },
    );
  });

  both('#16 Revoke invitation names the person and the email', (lang) => {
    TestBed.inject(UserStatusActionsService).confirmRevokeInvitation(user, result);
    expect(said()).toEqual(
      lang === 'en'
        ? {
            header: "Revoke Nora Al-Otaibi's invitation?",
            message: 'The invitation link stops working, the seat is freed, and the invitation is removed. You can invite nora@example.test again.',
            accept: 'Revoke invitation',
          }
        : {
            header: 'إلغاء دعوة Nora Al-Otaibi؟',
            message: 'يتوقف رابط الدعوة عن العمل، ويُحرَّر المقعد، وتُحذف الدعوة. ويمكنك دعوة nora@example.test مجددًا.',
            accept: 'إلغاء الدعوة',
          },
    );
  });

  // ── #17 Remove action ───────────────────────────────────────────────────────
  both('#17 Remove action names the action type in words, never the enum', (lang) => {
    create(WorkflowActionConfiguratorComponent).onRemove({ id: 'a1', actionType: 'SEND_NOTIFICATION', order: 1 } as never);
    const words = said();
    expect(words).toEqual(
      lang === 'en'
        ? { header: 'Remove the “Send notification” action?', message: "It's deleted, and no longer runs when this transition fires.", accept: 'Remove action' }
        : { header: 'إزالة إجراء «إرسال إشعار»؟', message: 'يُحذف، ولن يعمل بعد الآن عند تنفيذ هذا الانتقال.', accept: 'إزالة الإجراء' },
    );
    expect(words.header).not.toContain('SEND_NOTIFICATION');
  });

  it('#17 a type with no translation reads "Unknown", not its key', () => {
    setup('en');
    create(WorkflowActionConfiguratorComponent).onRemove({ id: 'a2', actionType: 'SOMETHING_NEW', order: 1 } as never);
    expect(said().header).toBe('Remove the “Unknown” action?');
  });

  for (const lang of ['en', 'ar'] as const) {
    it(`#17 the trash button names the action it removes — ${lang === 'en' ? 'English' : 'Arabic'}`, () => {
    setup(lang, [{ provide: NavigationAccessService, useValue: { hasPermission: () => true } }]);
    const fixture = TestBed.createComponent(WorkflowActionConfiguratorComponent);
    fixture.componentInstance.transitionId = 't1';
    fixture.componentInstance.actions = [{ id: 'a1', actionType: 'SEND_NOTIFICATION', order: 1, isEnabled: true } as never];
    fixture.detectChanges();
    const trash = (fixture.nativeElement as HTMLElement).querySelector('p-button:has(.pi-trash) button');
    // NON-VACUITY: the button rendered at all.
    expect(trash).withContext('the trash button rendered').not.toBeNull();
    expect(trash!.getAttribute('aria-label')).toBe(
      lang === 'en' ? 'Remove the Send notification action' : 'إزالة إجراء إرسال إشعار',
    );
    });
  }

  // ── #18, #19, #20 the workflow editors ──────────────────────────────────────
  both('#18 Remove stage, in the session\'s language', (lang) => {
    create(WorkflowStageListComponent).onRemove({ id: 's1', nameEn: 'Quality Review', nameAr: 'مراجعة الجودة' } as never);
    expect(said()).toEqual(
      lang === 'en'
        ? { header: 'Remove the stage “Quality Review”?', message: "It's deleted for good, with the tasks defined on it.", accept: 'Remove stage' }
        : { header: 'إزالة المرحلة «مراجعة الجودة»؟', message: 'تُحذف نهائيًا مع المهام المعرَّفة عليها.', accept: 'إزالة المرحلة' },
    );
  });

  const stop = { stopPropagation: () => undefined } as Event;

  both('#19 Deactivate a template that is not the default', (lang) => {
    create(WorkflowTemplateListComponent).onDeactivate({ id: 'w1', nameEn: 'Document Request', nameAr: 'طلب مستند', isDefault: false } as never, stop);
    expect(said()).toEqual(
      lang === 'en'
        ? {
            header: 'Deactivate the template “Document Request”?',
            message: 'Records already on it carry on, and new records keep starting on the default template.',
            accept: 'Deactivate template',
          }
        : {
            header: 'تعطيل القالب «طلب مستند»؟',
            message: 'تستمر السجلات الموجودة عليه، وتبدأ السجلات الجديدة على القالب الافتراضي كالمعتاد.',
            accept: 'تعطيل القالب',
          },
    );
  });

  both('#19 Deactivate the default template says new records cannot start', (lang) => {
    create(WorkflowTemplateListComponent).onDeactivate({ id: 'w2', nameEn: 'Committee', nameAr: 'لجنة', isDefault: true } as never, stop);
    expect(said().message).toBe(
      lang === 'en'
        ? "Records already on it carry on. It's the default, so new records of its type can't start until another template is made the default."
        : 'تستمر السجلات الموجودة عليه. ولأنه القالب الافتراضي، لن تبدأ سجلات جديدة من نوعه حتى يُعيَّن قالب آخر افتراضيًا.',
    );
  });

  both('#20 Remove transition, in the session\'s language', (lang) => {
    create(WorkflowTransitionEditorComponent, { stageId: 's1', transitions: [], availableStages: [] }).onRemove({
      id: 't1', labelEn: 'Approve', labelAr: 'اعتماد',
    } as never);
    expect(said()).toEqual(
      lang === 'en'
        ? {
            header: 'Remove the transition “Approve”?',
            message: 'Records can no longer move this way, and its actions are deleted with it.',
            accept: 'Remove transition',
          }
        : {
            header: 'إزالة الانتقال «اعتماد»؟',
            message: 'لن تتمكن السجلات من الانتقال بهذا المسار، وتُحذف إجراءاته معه.',
            accept: 'إزالة الانتقال',
          },
    );
  });

  // ── #22 Suspend tenant ──────────────────────────────────────────────────────
  both('#22 Suspend tenant says what stops and that nothing is deleted', (lang) => {
    create(TenantListComponent).onSuspend({ id: 'o1', name: 'Al Manara Clinic' } as never);
    expect(said()).toEqual(
      lang === 'en'
        ? {
            header: 'Suspend Al Manara Clinic?',
            message:
              "Its users are stopped on their next request and can't sign in, and its invitations stop working. Nothing is deleted, and reactivating it restores access.",
            accept: 'Suspend',
          }
        : {
            header: 'إيقاف Al Manara Clinic؟',
            message:
              'يُوقَف مستخدموها عند طلبهم التالي ولا يمكنهم تسجيل الدخول، وتتوقف دعواتها عن العمل. لا يُحذف شيء، وإعادة تفعيلها تعيد الوصول.',
            accept: 'إيقاف',
          },
    );
  });
});
