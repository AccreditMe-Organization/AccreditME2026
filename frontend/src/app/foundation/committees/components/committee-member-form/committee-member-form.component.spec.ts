import { Component, TemplateRef, ViewChild, signal } from '@angular/core';
import { ComponentFixture, TestBed, fakeAsync, flush, tick } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, TestRequest, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { provideRouter } from '@angular/router';
import { TranslateService, provideTranslateService } from '@ngx-translate/core';
import { ConfirmationService } from 'primeng/api';
import en from '../../../../../assets/i18n/en.json';
import ar from '../../../../../assets/i18n/ar.json';
import { environment } from '../../../../../environments/environment';
import { loadTranslationsForTest, provideFormatTesting } from '../../../../core/formatting/testing';
import { EditDialogComponent } from '../../../../shared/components/edit-dialog/edit-dialog.component';
import { LayerStackService } from '../../../../shared/overlay/layer-stack.service';
import { CommitteeMemberDto } from '../../services/committee.service';
import { CommitteeMemberFormComponent, addMemberRefusal } from './committee-member-form.component';
import { HttpErrorResponse } from '@angular/common/http';

// ACC-120 slice 4 — Add member: the person picker as its own layer, the joined
// date, the field wrapper, and refusals said from their status. Hosted the way
// committee-detail hosts it: inside the page's EditDialogComponent, with the
// form's dirty state passed to the dialog's [dirty].

const API = environment.apiUrl;

function member(userId: string, over: Partial<CommitteeMemberDto> = {}): CommitteeMemberDto {
  return {
    id: `m-${userId}`,
    organizationId: 'org-1',
    committeeId: 'c-1',
    userId,
    roleValueId: 'role-member',
    joinedAt: '2026-01-05T00:00:00.000Z',
    leftAt: null,
    isActive: true,
    ...over,
  };
}

const PEOPLE = [
  { id: 'u-huda', name: 'Huda Al-Harbi', email: 'huda@example.test', primaryOrgUnitId: 'unit-q', status: 'ACTIVE' },
  { id: 'u-khalid', name: 'Khalid Al-Otaibi', email: 'khalid@example.test', primaryOrgUnitId: null, status: 'ACTIVE' },
  { id: 'u-mona', name: 'Mona Al-Zahrani', email: 'mona@example.test', primaryOrgUnitId: 'unit-q', status: 'ACTIVE' },
];

@Component({
  standalone: true,
  imports: [EditDialogComponent, CommitteeMemberFormComponent],
  template: `
    <ng-template #formTpl>
      <app-committee-member-form
        committeeId="c-1"
        [member]="editing()"
        [activeMembers]="members()"
        (saved)="savedCount = savedCount + 1; visible.set(false)"
        (cancelled)="visible.set(false)"
        (dirtyChange)="dirty.set($event)"
      />
    </ng-template>
    <app-edit-dialog
      [(visible)]="visible"
      header="Add Member"
      [content]="formTpl"
      [dirty]="dirty()"
    />
  `,
})
class HostComponent {
  @ViewChild('formTpl', { read: TemplateRef, static: true }) formTpl!: TemplateRef<unknown>;
  readonly visible = signal(true);
  readonly dirty = signal(false);
  readonly editing = signal<CommitteeMemberDto | null>(null);
  readonly members = signal<CommitteeMemberDto[]>([member('u-huda')]);
  savedCount = 0;
}

describe('CommitteeMemberFormComponent — Add member (ACC-120 slice 4)', () => {
  let fixture: ComponentFixture<HostComponent>;
  let http: HttpTestingController;
  let confirm: jasmine.Spy;

  function setup(editing: CommitteeMemberDto | null = null): void {
    TestBed.configureTestingModule({
      imports: [HostComponent],
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        provideNoopAnimations(),
        provideTranslateService({ lang: 'en' }),
        provideFormatTesting(),
        ConfirmationService,
      ],
    });
    loadTranslationsForTest({ en, ar });
    TestBed.inject(TranslateService).use('en');
    confirm = spyOn(TestBed.inject(ConfirmationService), 'confirm');
    http = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(HostComponent);
    fixture.componentInstance.editing.set(editing);
    fixture.detectChanges();
    http.expectOne(`${API}/organization/units/flat`).flush([
      { id: 'unit-q', nameEn: 'Quality', nameAr: 'الجودة' },
    ]);
    http.expectOne(`${API}/lookups/categories/committee_member_role/values`).flush([
      { id: 'role-member', labelEn: 'Member', labelAr: 'عضو' },
      { id: 'role-secretary', labelEn: 'Secretary', labelAr: null },
    ]);
    fixture.detectChanges();
  }

  const q = <T extends HTMLElement>(sel: string): T | null => document.querySelector<T>(sel);
  function findForm(): CommitteeMemberFormComponent {
    const host = fixture.debugElement.query((d) => d.componentInstance instanceof CommitteeMemberFormComponent);
    if (host) return host.componentInstance as CommitteeMemberFormComponent;
    // The dialog renders its content into <body>; reach it through the DOM.
    const ng = (window as unknown as { ng: { getComponent: (e: Element) => unknown } }).ng;
    return ng.getComponent(document.querySelector('app-committee-member-form')!) as CommitteeMemberFormComponent;
  }

  function openPicker(): TestRequest {
    q<HTMLButtonElement>('[data-testid="member-person-button"]')!.click();
    fixture.detectChanges();
    const req = http.expectOne((r) => r.url === `${API}/users` && r.params.get('status') === 'ACTIVE');
    req.flush({ data: PEOPLE, total: PEOPLE.length, page: 1, pageSize: 200 });
    fixture.detectChanges();
    return req;
  }

  const pickRows = () => Array.from(document.querySelectorAll<HTMLButtonElement>('[data-testid="simple-list-pick"]'));

  afterEach(() => {
    http.verify();
    document.querySelectorAll('.p-dialog-mask, .p-dialog').forEach((n) => n.remove());
  });

  it('add mode wraps every field: person, role, joined date and reason, each with its label', () => {
    setup();
    const fields = Array.from(document.querySelectorAll('[data-testid="member-add-form"] am-field'));
    expect(fields.length).withContext('fields rendered').toBe(4);
    const labels = fields.map((f) => f.querySelector('.am-field__label')!.textContent!.trim());
    expect(labels.map((l) => l.replace(/\s*\*\s*$/, ''))).toEqual(['Person', 'Role on committee', 'Joined', 'Reason']);
    // Joined defaults to today, so leaving it is the server's own default.
    expect(q<HTMLInputElement>('[data-testid="member-joined"]')!.value).not.toBe('');
  });

  it('the picker lists every active person; a current member is there, disabled, reading "Already a member"', () => {
    setup();
    openPicker();
    const rows = pickRows();
    expect(rows.length).withContext('people rendered').toBe(3);
    const huda = rows.find((r) => r.textContent!.includes('Huda Al-Harbi'))!;
    expect(huda.getAttribute('aria-disabled')).toBe('true');
    expect(huda.textContent).toContain('Already a member');
    for (const other of rows.filter((r) => r !== huda)) {
      expect(other.hasAttribute('aria-disabled')).toBeFalse();
      expect(other.textContent).not.toContain('Already a member');
    }
    // A unit is named, never its id; no unit reads "—".
    expect(huda.textContent).toContain('Quality');
    expect(rows.find((r) => r.textContent!.includes('Khalid'))!.textContent).toContain('—');
  });

  it('picking someone closes the picker, fills the field and makes the form dirty', fakeAsync(() => {
    setup();
    openPicker();
    pickRows().find((r) => r.textContent!.includes('Mona'))!.click();
    fixture.detectChanges();
    flush();
    fixture.detectChanges();
    expect(findForm().pickerOpen()).toBeFalse();
    expect(q<HTMLInputElement>('[data-testid="member-person"]')!.value).toBe('Mona Al-Zahrani');
    expect(fixture.componentInstance.dirty()).withContext('the dialog knows the form is dirty').toBeTrue();
  }));

  it('a disabled row cannot be picked', () => {
    setup();
    openPicker();
    pickRows().find((r) => r.textContent!.includes('Huda'))!.click();
    fixture.detectChanges();
    expect(findForm().pickerOpen()).toBeTrue();
    expect(findForm().form.controls.userId.value).toBeNull();
  });

  it('Escape with the picker open closes ONLY the picker: the form stays, and nothing asks to discard', fakeAsync(() => {
    setup();
    openPicker();
    const layers = TestBed.inject(LayerStackService);
    expect(layers.depth()).withContext('the dialog and the picker are both layers').toBe(2);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    fixture.detectChanges();
    flush();
    expect(findForm().pickerOpen()).toBeFalse();
    expect(fixture.componentInstance.visible()).withContext('the Add member dialog is still open').toBeTrue();
    expect(confirm).not.toHaveBeenCalled();
    expect(layers.depth()).toBe(1);
  }));

  it('Escape in the date view returns to the form, and never reaches the dialog', fakeAsync(() => {
    setup();
    q<HTMLButtonElement>('[data-testid="member-joined-button"]')!.click();
    fixture.detectChanges();
    expect(q('[data-testid="member-date-view"]')).not.toBeNull();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    fixture.detectChanges();
    flush();
    expect(q('[data-testid="member-date-view"]')).toBeNull();
    expect(q('[data-testid="member-add-form"]')).not.toBeNull();
    expect(fixture.componentInstance.visible()).toBeTrue();
    expect(confirm).not.toHaveBeenCalled();
  }));

  it('Cancel on a dirty form asks before discarding, as Escape does', fakeAsync(() => {
    setup();
    openPicker();
    pickRows().find((r) => r.textContent!.includes('Mona'))!.click();
    fixture.detectChanges();
    flush();
    fixture.detectChanges();
    const cancel = Array.from(document.querySelectorAll<HTMLButtonElement>('[data-testid="member-add-form"] button')).find(
      (b) => b.textContent!.trim() === 'Cancel',
    )!;
    cancel.click();
    fixture.detectChanges();
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(fixture.componentInstance.visible()).toBeTrue();
  }));

  it('saves with today: sends the person, the role and the reason, and no date (the server records now)', fakeAsync(() => {
    setup();
    openPicker();
    pickRows().find((r) => r.textContent!.includes('Mona'))!.click();
    fixture.detectChanges();
    flush();
    findForm().form.controls.roleValueId.setValue('role-secretary');
    findForm().form.controls.reason.setValue('  Joined for the audit  ');
    fixture.detectChanges();
    q<HTMLButtonElement>('[data-testid="member-submit"] button')!.click();
    fixture.detectChanges();
    const req = http.expectOne(`${API}/committees/c-1/members`);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ userId: 'u-mona', roleValueId: 'role-secretary', reason: 'Joined for the audit' });
    req.flush(member('u-mona'));
    fixture.detectChanges();
    expect(fixture.componentInstance.savedCount).toBe(1);
    expect(fixture.componentInstance.dirty()).toBeFalse();
    flush();
  }));

  it('an earlier joined date is sent as effectiveDate, the start of that day', fakeAsync(() => {
    setup();
    const c = findForm();
    c.form.controls.userId.setValue('u-mona');
    c.form.controls.roleValueId.setValue('role-member');
    const earlier = new Date();
    earlier.setDate(earlier.getDate() - 10);
    c.onDayPicked(earlier);
    fixture.detectChanges();
    q<HTMLButtonElement>('[data-testid="member-submit"] button')!.click();
    fixture.detectChanges();
    const req = http.expectOne(`${API}/committees/c-1/members`);
    const day = new Date(earlier);
    day.setHours(0, 0, 0, 0);
    expect(req.request.body.effectiveDate).toBe(day.toISOString());
    req.flush(member('u-mona'));
    flush();
  }));

  it('a joined date after today is refused on the form, and nothing is sent', fakeAsync(() => {
    setup();
    const c = findForm();
    c.form.controls.userId.setValue('u-mona');
    c.form.controls.roleValueId.setValue('role-member');
    const later = new Date();
    later.setDate(later.getDate() + 3);
    c.form.controls.joinedOn.setValue(later);
    fixture.detectChanges();
    q<HTMLButtonElement>('[data-testid="member-submit"] button')!.click();
    fixture.detectChanges();
    tick();
    fixture.detectChanges();
    http.expectNone(`${API}/committees/c-1/members`);
    expect(document.body.textContent).toContain("The joined date can't be after today.");
  }));

  it('nothing chosen: Save says what is missing, under each field, and sends nothing', fakeAsync(() => {
    setup();
    q<HTMLButtonElement>('[data-testid="member-submit"] button')!.click();
    fixture.detectChanges();
    tick();
    fixture.detectChanges();
    http.expectNone(`${API}/committees/c-1/members`);
    expect(document.body.textContent).toContain('Choose who to add.');
    expect(document.body.textContent).toContain('Choose their role on the committee.');
  }));

  it('a refusal is said from its status, never the server text', fakeAsync(() => {
    setup();
    const c = findForm();
    c.form.controls.userId.setValue('u-mona');
    c.form.controls.roleValueId.setValue('role-member');
    q<HTMLButtonElement>('[data-testid="member-submit"] button')!.click();
    fixture.detectChanges();
    http
      .expectOne(`${API}/committees/c-1/members`)
      .flush({ message: 'This user is already an active member of this committee' }, { status: 409, statusText: 'Conflict' });
    fixture.detectChanges();
    const error = q('[data-testid="member-save-error"]')!;
    expect(error.textContent!.trim()).toBe('This person is already a member of this committee.');
    expect(document.body.textContent).not.toContain('already an active member');
    flush();
  }));

  it('when everyone active is already a member, the field says so', () => {
    setup();
    fixture.componentInstance.members.set(PEOPLE.map((p) => member(p.id)));
    fixture.detectChanges();
    openPicker();
    expect(pickRows().every((r) => r.getAttribute('aria-disabled') === 'true')).toBeTrue();
    expect(document.body.textContent).toContain('Everyone active is already a member of this committee.');
  });

  // Measured on a 390px phone: the input's intrinsic width counted toward the
  // Person and Joined rows' minimum and held the dialog at 395px. A row's
  // narrowest is now its 36px button and the gap.
  it('the Person and Joined rows can be as narrow as their button: nothing holds a phone dialog wide', () => {
    setup();
    const rows = Array.from(document.querySelectorAll<HTMLElement>('[data-testid="member-add-form"] .am-member-pick'));
    expect(rows.length).withContext('both picker rows rendered').toBe(2);
    for (const row of rows) {
      const button = row.querySelector('button')!.getBoundingClientRect();
      expect(button.width).withContext('the button is drawn').toBeGreaterThan(30);
      // What a dialog shrinks to is its content's MIN-CONTENT contribution:
      // a box sized min-content around a copy of the row is exactly that
      // (copied attributes keep the component's styles). min-width: 0 does
      // not lower it; only the input's zero width does.
      const box = document.createElement('div');
      box.style.cssText = 'position: absolute; inline-size: min-content; visibility: hidden';
      const copy = row.cloneNode(true) as HTMLElement;
      box.appendChild(copy);
      row.parentElement!.appendChild(box);
      const narrowest = box.getBoundingClientRect().width;
      box.remove();
      expect(narrowest).withContext('the row at its narrowest').toBeLessThanOrEqual(button.width + 16);
    }
  });

  it('Change role is untouched: no person, no joined date, no field wrapper', () => {
    setup(member('u-huda'));
    expect(q('[data-testid="member-add-form"]')).toBeNull();
    expect(q('[data-testid="member-person"]')).toBeNull();
    expect(q('[data-testid="member-joined"]')).toBeNull();
    expect(document.querySelectorAll('app-committee-member-form am-field').length).toBe(0);
    expect(document.querySelector('app-committee-member-form label[for="roleValueId"]')).not.toBeNull();
  });
});

// A pure function: no form, no HTTP.
describe('addMemberRefusal (ACC-120 slice 4)', () => {
  it('maps each status to its own sentence', () => {
    const err = (status: number) => new HttpErrorResponse({ status });
    expect(addMemberRefusal(err(409))).toBe('committee.memberForm.errorAlreadyMember');
    expect(addMemberRefusal(err(403))).toBe('committee.memberForm.errorDenied');
    expect(addMemberRefusal(err(404))).toBe('committee.memberForm.errorNotFound');
    expect(addMemberRefusal(err(500))).toBe('committee.memberForm.errorSave');
    expect(addMemberRefusal(new Error('offline'))).toBe('committee.memberForm.errorSave');
  });
});
