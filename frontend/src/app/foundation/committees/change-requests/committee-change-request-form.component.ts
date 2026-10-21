import { Component, DestroyRef, ElementRef, HostListener, OnDestroy, ViewEncapsulation, computed, effect, inject, signal, untracked } from '@angular/core';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { AbstractControl, FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { Observable, catchError, debounceTime, distinctUntilChanged, forkJoin, map, of, startWith, switchMap, tap } from 'rxjs';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { ButtonModule } from 'primeng/button';
import { InputTextModule } from 'primeng/inputtext';
import { InputNumberModule } from 'primeng/inputnumber';
import { TextareaModule } from 'primeng/textarea';
import { FormatService } from '../../../core/formatting';
import { InputNumberLatinDigits } from '../../../core/formatting/latin-digits';
import { BreadcrumbParentService } from '../../../core/navigation/breadcrumb-parent.service';
import { AuthService } from '../../../core/services/auth.service';
import { LanguageService } from '../../../core/services/language.service';
import { AmConfirmService } from '../../../shared/components/confirm/am-confirm.service';
import { FieldComponent } from '../../../shared/components/field/field.component';
import { OverlaySelectComponent } from '../../../shared/components/overlay-select/overlay-select.component';
import { PageHeaderComponent } from '../../../shared/components/page-header/page-header.component';
import { LookupService, LookupValueDto } from '../../lookup/services/lookup.service';
import { OrgUnitCascadeOption, OrgUnitDto, OrgUnitService, buildOrgUnitCascadeOptions, orgUnitDisplayName } from '../../organization/services/org-unit.service';
import { LeaveGuarded } from '../../roles/permission-matrix/leave-guard';
import { referenceOptions } from '../committee-references';
import { COMMITTEE_MEETING_FREQUENCIES, CommitteeDetailDto, CommitteeListItemDto, CommitteeService } from '../services/committee.service';
import { ChangeRequestText, ImpactLineText } from './change-request-text';
import {
  CHANGE_FIELDS,
  ChangeField,
  ChangeRequestDto,
  ChangeRequestLabelsDto,
  ChangeRequestPreviewDto,
  ChangeRequestService,
  ChangeValue,
  ChangeValues,
} from './change-request.service';

/** The groups, as the Edit dialog's tabs name them, in the order a reader meets them. */
export const CHANGE_FORM_GROUPS: readonly { id: 'identity' | 'governance' | 'structure'; fields: readonly ChangeField[] }[] = [
  { id: 'identity', fields: ['nameEn', 'nameAr', 'typeValueId', 'purpose'] },
  { id: 'governance', fields: ['quorumCount', 'meetingFrequency'] },
  { id: 'structure', fields: ['orgUnitId', 'parentCommitteeId', 'reportingToCommitteeId'] },
];

/** A field the server never clears: an empty value there is "not changing". */
const REQUIRED: ReadonlySet<ChangeField> = new Set(['nameEn', 'typeValueId', 'quorumCount', 'meetingFrequency', 'orgUnitId']);
/** Cleared by an empty value (ACC-160: never ''). */
const CLEARED_BY_EMPTY: ReadonlySet<ChangeField> = new Set(['nameAr', 'purpose']);
const PREVIEW_DELAY_MS = 400;

type Phase = 'loading' | 'error' | 'ready';
type PreviewState = { kind: 'none' } | { kind: 'loading' } | { kind: 'failed' } | { kind: 'ready'; preview: ChangeRequestPreviewDto };
type Footer = { text: string; retry: boolean; reload: boolean } | null;
type ChoiceList = 'types' | 'units' | 'committees';

/** A value as the server compares it: text trimmed, an emptied optional text is null. */
export function normaliseValue(field: ChangeField, value: unknown): ChangeValue {
  if (value === undefined || value === null) return null;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed === '' && (CLEARED_BY_EMPTY.has(field) || REQUIRED.has(field)) ? null : trimmed;
  }
  return value as ChangeValue;
}

/**
 * The proposal as a diff against the committee, the way the server's
 * `normaliseChanges()` reads it: a value equal to today's is not a change, and
 * an emptied required field is not one either (its own validator says why).
 */
export function diffChanges(values: Partial<Record<ChangeField, unknown>>, committee: Partial<Record<ChangeField, unknown>>): ChangeValues {
  const out: ChangeValues = {};
  for (const field of CHANGE_FIELDS) {
    const next = normaliseValue(field, values[field]);
    if (next === null && REQUIRED.has(field)) continue;
    if (next !== normaliseValue(field, committee[field])) out[field] = next;
  }
  return out;
}

/**
 * ACC-240 — Request a change (`/committees/:id/change-requests/new`) and its
 * draft edit (`…/:requestId/edit`): one page, plan §3.2.
 *
 * Every field starts at the committee's current value (an edit: at the draft's
 * proposal). A field that differs from today is marked three ways — "✎
 * Changed" beside its label, a 2px border, and "was …" in its message slot —
 * and "Changing: …" sums them up above the reason. "What this change does" is
 * the server's preview, asked 400 ms after the last change. Save as draft and
 * Submit for review are never disabled (rule 5.2): with nothing changed they
 * say "Change at least one field.", and a missing reason fills its slot.
 *
 * Who may open it is the server's answer, never a copy here: a new request
 * opens only with `canRaise` (an open request is opened instead), an edit only
 * with `actions.edit`.
 */
@Component({
  selector: 'am-committee-change-request-form',
  standalone: true,
  encapsulation: ViewEncapsulation.None,
  imports: [
    ReactiveFormsModule,
    TranslatePipe,
    ButtonModule,
    InputTextModule,
    InputNumberModule,
    InputNumberLatinDigits,
    TextareaModule,
    FieldComponent,
    OverlaySelectComponent,
    PageHeaderComponent,
  ],
  template: `
    @switch (phase()) {
      @case ('loading') {
        <p class="am-crf__state" role="status" data-testid="crf-loading">{{ 'committee.changeRequest.form.loading' | translate }}</p>
      }
      @case ('error') {
        <div class="am-crf__state" role="alert" data-testid="crf-error">
          <span>{{ 'committee.changeRequest.form.loadError' | translate }}</span>
          <button type="button" class="am-crf__link" (click)="load()">{{ 'common.retry' | translate }}</button>
        </div>
      }
      @case ('ready') {
        <div class="am-crf">
          <app-page-header [eyebrow]="eyebrow()" [title]="title()" [purpose]="'committee.changeRequest.form.intro' | translate" />

          <form [formGroup]="form" class="am-crf__form" (ngSubmit)="save(true)" novalidate>
            @if (noChanges()) {
              <p class="am-crf__nochange" role="alert" tabindex="-1" data-testid="crf-no-changes">
                {{ 'committee.changeRequest.form.noChanges' | translate }}
              </p>
            }

            @for (group of groups; track group.id) {
              <section class="am-crf__group" [attr.data-crf-group]="group.id" [attr.aria-labelledby]="'crf-h-' + group.id">
                <h2 class="am-crf__heading" [id]="'crf-h-' + group.id">{{ 'committee.form.tab.' + group.id | translate }}</h2>
                <div class="am-crf__grid">
                  @for (f of group.fields; track f) {
                    <div
                      class="am-crf__f"
                      [class.am-crf__f--wide]="f === 'purpose'"
                      [class.am-crf__f--changed]="isChanged(f)"
                      [attr.data-crf-field]="f"
                    >
                      @if (isChanged(f)) {
                        <span class="am-crf__mark" data-testid="crf-changed">{{ 'committee.changeRequest.form.changed' | translate }}</span>
                      }
                      <am-field
                        [label]="labelOf(f) | translate"
                        [control]="form.controls[f]"
                        [inputId]="'crf-' + f"
                        [hint]="hintFor(f)"
                        [hintAction]="retryFor(f)"
                        [forceShowErrors]="showErrors()"
                        [errorMessages]="errorKeys(f)"
                      >
                        @switch (f) {
                          @case ('nameEn') {
                            <input pInputText id="crf-nameEn" formControlName="nameEn" autocomplete="off" />
                          }
                          @case ('nameAr') {
                            <input pInputText id="crf-nameAr" formControlName="nameAr" dir="rtl" autocomplete="off" />
                          }
                          @case ('typeValueId') {
                            <app-overlay-select
                              formControlName="typeValueId"
                              [options]="typeOptions()"
                              optionLabel="label"
                              optionValue="id"
                              [placeholder]="(typesLoaded() ? 'committee.selectType' : 'common.loading') | translate"
                            />
                          }
                          @case ('purpose') {
                            <textarea pTextarea id="crf-purpose" formControlName="purpose" rows="3"></textarea>
                          }
                          @case ('quorumCount') {
                            <p-inputNumber inputId="crf-quorumCount" formControlName="quorumCount" [min]="1" [showButtons]="true" [fluid]="true" />
                          }
                          @case ('meetingFrequency') {
                            <app-overlay-select formControlName="meetingFrequency" [options]="frequencyOptions()" optionLabel="label" optionValue="value" />
                          }
                          @case ('orgUnitId') {
                            <app-overlay-select
                              formControlName="orgUnitId"
                              [options]="unitOptions()"
                              optionLabel="label"
                              optionValue="value"
                              optionGroupLabel="label"
                              optionGroupChildren="items"
                              [placeholder]="(unitsLoaded() ? 'committee.selectOwningUnit' : 'common.loading') | translate"
                            />
                          }
                          @case ('parentCommitteeId') {
                            <app-overlay-select
                              formControlName="parentCommitteeId"
                              [options]="parentOptions()"
                              optionLabel="label"
                              optionValue="id"
                              [showClear]="true"
                              [placeholder]="(committeesLoaded() ? 'committee.noneOption' : 'common.loading') | translate"
                            />
                          }
                          @case ('reportingToCommitteeId') {
                            <app-overlay-select
                              formControlName="reportingToCommitteeId"
                              [options]="reportsToOptions()"
                              optionLabel="label"
                              optionValue="id"
                              [showClear]="true"
                              [placeholder]="(committeesLoaded() ? 'committee.noneOption' : 'common.loading') | translate"
                            />
                          }
                        }
                      </am-field>
                    </div>
                  }
                </div>
              </section>
            }

            @if (changedList().length) {
              <p class="am-crf__summary" data-testid="crf-summary">
                {{ 'committee.changeRequest.form.summary' | translate: { fields: text.fieldList(changedList()) } }}
              </p>
            }

            <div class="am-crf__f am-crf__f--wide" data-crf-field="reason">
              <am-field
                [label]="'committee.changeRequest.form.reason' | translate"
                [control]="form.controls.reason"
                inputId="crf-reason"
                [forceShowErrors]="showErrors()"
                [errorMessages]="{ required: 'committee.changeRequest.form.reasonRequired', pattern: 'committee.changeRequest.form.reasonRequired' }"
              >
                <textarea pTextarea id="crf-reason" formControlName="reason" rows="3"></textarea>
              </am-field>
            </div>

            <section class="am-crf__impact" aria-labelledby="crf-h-impact" data-testid="crf-impact">
              <h2 class="am-crf__heading" id="crf-h-impact">{{ 'committee.changeRequest.impact.title' | translate }}</h2>
              @switch (preview().kind) {
                @case ('none') {
                  <p class="am-crf__muted">{{ 'committee.changeRequest.impact.none' | translate }}</p>
                }
                @case ('loading') {
                  <p class="am-crf__muted" role="status" data-testid="crf-impact-loading">{{ 'committee.changeRequest.impact.loading' | translate }}</p>
                }
                @case ('failed') {
                  <p class="am-crf__muted" data-testid="crf-impact-failed">
                    {{ 'committee.changeRequest.impact.failed' | translate }}
                    <button type="button" class="am-crf__link" (click)="retryPreview()">{{ 'common.retry' | translate }}</button>
                  </p>
                }
                @case ('ready') {
                  <dl class="am-crf__lines">
                    @for (line of impactLines(); track $index) {
                      <div class="am-crf__line" data-testid="crf-impact-line">
                        <dt>{{ line.key }}</dt>
                        <dd>{{ line.value }}</dd>
                      </div>
                    }
                  </dl>
                }
              }
            </section>
          </form>

          <div class="am-crf__foot" role="region" [attr.aria-label]="title()">
            @if (footer(); as f) {
              <p class="am-crf__foot-message" role="alert" data-testid="crf-footer-message">{{ f.text }}</p>
            } @else {
              <span class="am-crf__foot-note">{{ 'committee.changeRequest.form.goesTo' | translate }}</span>
            }
            <div class="am-crf__buttons">
              <p-button type="button" [label]="'common.cancel' | translate" severity="secondary" [text]="true" [disabled]="saving()" (onClick)="cancel()" data-testid="crf-cancel" />
              @if (footer()?.reload) {
                <p-button type="button" [label]="'committee.form.reload' | translate" (onClick)="reload()" data-testid="crf-reload" />
              } @else if (footer()?.retry) {
                <p-button type="button" [label]="'list.retry' | translate" [loading]="saving()" (onClick)="save(lastSubmit)" data-testid="crf-retry" />
              } @else {
                <p-button
                  type="button"
                  [label]="'committee.changeRequest.form.saveDraft' | translate"
                  severity="secondary"
                  [outlined]="true"
                  [loading]="saving() && !lastSubmit"
                  (onClick)="save(false)"
                  data-testid="crf-save-draft"
                />
                <p-button
                  type="button"
                  [label]="'committee.changeRequest.form.submit' | translate"
                  [loading]="saving() && lastSubmit"
                  (onClick)="save(true)"
                  data-testid="crf-submit"
                />
              }
            </div>
          </div>
        </div>
      }
    }
  `,
  styles: [
    `
      .am-crf{display:flex;flex-direction:column;gap:var(--am-space-16);max-inline-size:880px;padding-block-end:0}
      .am-crf__state{display:flex;align-items:center;gap:var(--am-space-8);margin:0;padding:var(--am-space-16) 0;color:var(--am-ink-700)}
      .am-crf__form{display:flex;flex-direction:column;gap:var(--am-space-16);min-inline-size:0}
      .am-crf__group,.am-crf__impact{background:var(--am-card,#fff);border:1px solid var(--am-border);border-radius:var(--am-radius-card);padding:14px 18px;min-inline-size:0}
      .am-crf__heading{margin:0 0 var(--am-space-8);font-size:13px;font-weight:600;color:var(--am-ink-900)}
      .am-crf__grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(260px,100%),1fr));gap:0 var(--am-space-16)}
      .am-crf__f{position:relative;min-inline-size:0}
      .am-crf__f--wide{grid-column:1 / -1}
      .am-crf__mark{position:absolute;inset-inline-end:0;inset-block-start:0;font-size:11.5px;font-weight:600;color:var(--am-primary-700);line-height:18px}
      .am-crf__f--changed .p-inputtext,.am-crf__f--changed .p-textarea,.am-crf__f--changed .am-overlay-select-trigger,.am-crf__f--changed .p-inputnumber-input{border-color:var(--am-primary-700);box-shadow:inset 0 0 0 1px var(--am-primary-700)}
      .am-crf__summary{margin:0;padding:10px 14px;border-radius:var(--am-radius-card);background:var(--am-info-bg);border:1px solid var(--am-info-border);color:var(--am-info-ink);font-weight:600;overflow-wrap:anywhere}
      .am-crf__nochange{margin:0;padding:10px 14px;border-radius:var(--am-radius-card);background:var(--am-danger-bg);border:1px solid var(--am-danger-border);color:var(--am-danger-ink);font-weight:600}
      .am-crf__nochange:focus-visible{outline:var(--am-focus-ring-width) solid var(--am-focus-ring);outline-offset:var(--am-focus-ring-offset)}
      .am-crf__muted{margin:0;color:var(--am-ink-700);font-size:12.5px}
      .am-crf__lines{margin:0;display:flex;flex-direction:column;gap:var(--am-space-8)}
      .am-crf__line{display:grid;grid-template-columns:minmax(0,220px) minmax(0,1fr);gap:var(--am-space-12);font-size:12.5px}
      .am-crf__line dt{font-weight:600;color:var(--am-ink-900);overflow-wrap:anywhere}
      .am-crf__line dd{margin:0;color:var(--am-ink-700);overflow-wrap:anywhere}
      .am-crf__link{font:inherit;font-weight:600;color:var(--am-primary-700);background:none;border:0;padding:0;cursor:pointer}
      .am-crf__link:focus-visible{outline:var(--am-focus-ring-width) solid var(--am-focus-ring);outline-offset:var(--am-focus-ring-offset)}
      .am-crf__foot{position:sticky;inset-block-end:-16px;z-index:2;display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:var(--am-space-8) var(--am-space-16);margin-inline:-16px;margin-block-end:-16px;padding:12px 16px;background:var(--am-card,#fff);border-block-start:1px solid var(--am-border)}
      .am-crf__foot-note{font-size:var(--am-type-meta-size);color:var(--am-ink-500);min-inline-size:0}
      .am-crf__foot-message{margin:0;font-size:var(--am-type-meta-size);color:var(--am-danger-ink);min-inline-size:0}
      .am-crf__buttons{display:flex;flex-wrap:wrap;gap:var(--am-space-12);margin-inline-start:auto}
      @media (max-width: 559.98px){.am-crf__line{grid-template-columns:minmax(0,1fr);gap:var(--am-space-2)}}
    `,
  ],
})
export class CommitteeChangeRequestFormComponent implements LeaveGuarded, OnDestroy {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly fb = inject(FormBuilder);
  private readonly committees = inject(CommitteeService);
  private readonly lookups = inject(LookupService);
  private readonly orgUnits = inject(OrgUnitService);
  private readonly changeRequests = inject(ChangeRequestService);
  private readonly translate = inject(TranslateService);
  private readonly language = inject(LanguageService);
  private readonly format = inject(FormatService);
  private readonly auth = inject(AuthService);
  private readonly confirm = inject(AmConfirmService);
  private readonly breadcrumb = inject(BreadcrumbParentService);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly destroyRef = inject(DestroyRef);
  protected readonly text = inject(ChangeRequestText);

  readonly committeeId = this.route.snapshot.paramMap.get('id')!;
  readonly requestId = this.route.snapshot.paramMap.get('requestId');
  protected readonly groups = CHANGE_FORM_GROUPS;

  readonly phase = signal<Phase>('loading');
  readonly committee = signal<CommitteeDetailDto | null>(null);
  readonly request = signal<ChangeRequestDto | null>(null);
  readonly saving = signal(false);
  readonly showErrors = signal(false);
  readonly noChanges = signal(false);
  readonly footer = signal<Footer>(null);
  readonly refusedField = signal<{ field: ChangeField; text: string } | null>(null);
  readonly preview = signal<PreviewState>({ kind: 'none' });
  /** Which save the footer's Retry repeats. */
  lastSubmit = true;
  /** Set once saved, so leaving after a save never asks. */
  private done = false;
  private readonly previewRetry = signal(0);

  readonly types = signal<LookupValueDto[]>([]);
  readonly units = signal<OrgUnitDto[]>([]);
  readonly allCommittees = signal<CommitteeListItemDto[]>([]);
  readonly typesLoaded = signal(false);
  readonly unitsLoaded = signal(false);
  readonly committeesLoaded = signal(false);
  readonly failedLists = signal<ReadonlySet<ChoiceList>>(new Set());
  private readonly retryActions = new Map<ChoiceList, { label: string; run: () => void }>();

  readonly form = this.fb.group({
    nameEn: ['', [Validators.required, Validators.maxLength(150)]],
    nameAr: ['', [Validators.maxLength(150)]],
    typeValueId: [null as string | null, [Validators.required]],
    purpose: [''],
    quorumCount: [1 as number | null, [Validators.required, Validators.min(1)]],
    meetingFrequency: ['AS_NEEDED'],
    orgUnitId: [null as string | null, [Validators.required]],
    parentCommitteeId: [null as string | null],
    reportingToCommitteeId: [null as string | null],
    reason: ['', [Validators.required, Validators.pattern(/\S/), Validators.maxLength(2000)]],
  });

  private readonly values = toSignal(this.form.valueChanges.pipe(startWith(null), map(() => this.form.getRawValue())), {
    initialValue: this.form.getRawValue(),
  });

  /** The proposal: every field that differs from the committee today. */
  readonly changes = computed<ChangeValues>(() => {
    const committee = this.committee();
    return committee ? diffChanges(this.values() as Partial<Record<ChangeField, unknown>>, committee as unknown as Partial<Record<ChangeField, unknown>>) : {};
  });
  readonly changedList = computed(() => CHANGE_FIELDS.filter((f) => f in this.changes()));

  /** Names for every id the page shows: the lists, the committee's own type, and the preview's. */
  readonly labels = computed<ChangeRequestLabelsDto>(() => {
    const out: ChangeRequestLabelsDto = {};
    for (const t of this.types()) out[t.id] = { en: t.labelEn, ar: t.labelAr };
    const own = this.committee()?.typeValue;
    if (own) out[own.id] = { en: own.labelEn, ar: own.labelAr };
    for (const u of this.units()) out[u.id] = { en: u.nameEn, ar: u.nameAr };
    for (const c of this.allCommittees()) out[c.id] = { en: c.nameEn, ar: c.nameAr };
    Object.assign(out, this.request()?.labels ?? {});
    const p = this.preview();
    if (p.kind === 'ready') Object.assign(out, p.preview.labels);
    return out;
  });

  readonly eyebrow = computed(() => {
    this.translate.currentLang();
    const r = this.request();
    return r
      ? this.translate.instant('committee.changeRequest.form.eyebrowDraft', { n: this.format.number(r.number) })
      : this.translate.instant('committee.changeRequest.form.eyebrowNew');
  });
  readonly title = computed(() => {
    this.translate.currentLang();
    const r = this.request();
    return r
      ? this.translate.instant('committee.changeRequest.form.titleEdit', { n: this.format.number(r.number) })
      : this.translate.instant('committee.changeRequest.form.title');
  });

  readonly typeOptions = computed(() => {
    this.translate.currentLang();
    const options = this.types().map((v) => ({ id: v.id, label: this.language.bilingual(v.labelEn, v.labelAr) }));
    const own = this.committee()?.typeValue;
    if (own && !options.some((o) => o.id === own.id)) {
      options.push({ id: own.id, label: `${this.language.bilingual(own.labelEn, own.labelAr)} (${this.translate.instant('committee.form.notOffered')})` });
    }
    return options;
  });

  readonly frequencyOptions = computed(() => {
    this.translate.currentLang();
    return COMMITTEE_MEETING_FREQUENCIES.map((value) => ({ value, label: this.translate.instant(`committee.frequency.${value.toLowerCase()}`) }));
  });

  /** Active units only; the committee's own unit stays shown, marked, when it no longer is. */
  readonly unitOptions = computed(() => {
    this.translate.currentLang();
    const tree: OrgUnitCascadeOption[] = buildOrgUnitCascadeOptions(this.units(), null, null);
    const savedId = this.committee()?.orgUnitId ?? null;
    const has = (nodes: OrgUnitCascadeOption[]): boolean => nodes.some((n) => n.value === savedId || has(n.items ?? []));
    const saved = savedId ? this.units().find((u) => u.id === savedId) : undefined;
    if (saved && !has(tree)) tree.push({ label: `${orgUnitDisplayName(saved)} (${this.translate.instant('committee.form.notOffered')})`, value: saved.id });
    return tree;
  });

  readonly parentOptions = computed(() => this.referenceList('parent'));
  readonly reportsToOptions = computed(() => this.referenceList('reportsTo'));

  readonly impactLines = computed<ImpactLineText[]>(() => {
    this.translate.currentLang();
    const p = this.preview();
    if (p.kind !== 'ready') return [];
    const requester = this.request()?.requestedBy.name ?? this.auth.currentUser()?.name ?? '';
    return p.preview.impacts.map((impact) => this.text.impact(impact, this.labels(), requester));
  });

  private readonly memberCount = computed(() => this.allCommittees().find((c) => c.id === this.committeeId)?.memberCount ?? null);

  constructor() {
    this.load();

    // The preview: shown as working at once, asked 400 ms after the last
    // change, the earlier question dropped (switchMap).
    toObservable(computed(() => ({ changes: this.changes(), retry: this.previewRetry(), ready: this.phase() === 'ready' })))
      .pipe(
        distinctUntilChanged((a, b) => a.ready === b.ready && a.retry === b.retry && JSON.stringify(a.changes) === JSON.stringify(b.changes)),
        tap(({ changes, ready }) => {
          if (ready) this.preview.set(Object.keys(changes).length ? { kind: 'loading' } : { kind: 'none' });
        }),
        debounceTime(PREVIEW_DELAY_MS),
        switchMap(({ changes, ready }): Observable<PreviewState | null> => {
          if (!ready) return of(null);
          if (!Object.keys(changes).length) return of({ kind: 'none' });
          return this.changeRequests.preview(this.committeeId, changes).pipe(
            map((preview): PreviewState => ({ kind: 'ready', preview })),
            catchError((err: unknown) => {
              const refusal = this.text.refusal(err);
              if (refusal.field) this.refuse(refusal.field, refusal.text);
              return of<PreviewState>({ kind: 'failed' });
            }),
          );
        }),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((state) => {
        if (!state) return;
        if (state.kind === 'ready') this.clearRefusal();
        this.preview.set(state);
      });

    // A refusal belongs to the value it was about.
    this.form.valueChanges.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => {
      this.noChanges.set(false);
      if (this.footer() && !this.footer()!.reload) this.footer.set(null);
    });

    // The breadcrumb's parent is the committee.
    effect(() => {
      const c = this.committee();
      if (!c) return;
      untracked(() => this.breadcrumb.set(this.router.url, `/committees/${c.id}`, this.language.bilingual(c.nameEn, c.nameAr)));
    });
  }

  ngOnDestroy(): void {
    this.breadcrumb.clear(this.router.url);
  }

  /** What opening the page reads. A new request needs canRaise; an edit, actions.edit. */
  load(): void {
    this.phase.set('loading');
    const committee$ = this.committees.getById(this.committeeId);
    const gate$: Observable<{ request: ChangeRequestDto | null; go: string[] | null }> = this.requestId
      ? this.changeRequests.get(this.requestId).pipe(
          map((request) => ({ request, go: request.actions.edit ? null : this.requestLink(request.id) })),
        )
      : this.changeRequests.open(this.committeeId).pipe(
          map((open) => ({
            request: null,
            go: open.request ? this.requestLink(open.request.id) : open.canRaise ? null : ['/committees', this.committeeId],
          })),
        );
    forkJoin([committee$, gate$]).subscribe({
      next: ([committee, gate]) => {
        if (gate.go) {
          this.done = true;
          void this.router.navigate(gate.go, { replaceUrl: true });
          return;
        }
        this.committee.set(committee);
        this.request.set(gate.request);
        this.fill(committee, gate.request);
        this.phase.set('ready');
        this.loadLists();
      },
      error: () => this.phase.set('error'),
    });
  }

  private fill(committee: CommitteeDetailDto, request: ChangeRequestDto | null): void {
    const proposed = request?.changes ?? {};
    const pick = <T>(field: ChangeField, current: T): T => (field in proposed ? (proposed[field] as unknown as T) : current);
    this.form.reset({
      nameEn: pick('nameEn', committee.nameEn),
      nameAr: pick('nameAr', committee.nameAr ?? ''),
      typeValueId: pick('typeValueId', committee.typeValueId),
      purpose: pick('purpose', committee.purpose ?? ''),
      quorumCount: pick('quorumCount', committee.quorumCount),
      meetingFrequency: pick('meetingFrequency', committee.meetingFrequency),
      orgUnitId: pick('orgUnitId', committee.orgUnitId),
      parentCommitteeId: pick('parentCommitteeId', committee.parentCommitteeId),
      reportingToCommitteeId: pick('reportingToCommitteeId', committee.reportingToCommitteeId),
      reason: request?.reason ?? '',
    });
    this.form.markAsPristine();
    this.showErrors.set(false);
    this.noChanges.set(false);
    this.footer.set(null);
    this.clearRefusal();
  }

  private loadLists(): void {
    this.loadList('types');
    this.loadList('units');
    this.loadList('committees');
  }

  /** Each picker waits for its list; a failed list says so in the field's slot, with Retry. */
  private loadList(list: ChoiceList): void {
    this.failedLists.update((s) => new Set([...s].filter((l) => l !== list)));
    const fail = () => this.failedLists.update((s) => new Set([...s, list]));
    if (list === 'types') {
      this.typesLoaded.set(false);
      this.lookups.getValues('committee_type').subscribe({ next: (v) => (this.types.set(v), this.typesLoaded.set(true)), error: () => (fail(), this.typesLoaded.set(true)) });
    } else if (list === 'units') {
      this.unitsLoaded.set(false);
      this.orgUnits.getFlat().subscribe({ next: (v) => (this.units.set(v), this.unitsLoaded.set(true)), error: () => (fail(), this.unitsLoaded.set(true)) });
    } else {
      this.committeesLoaded.set(false);
      this.committees.listCommittees().subscribe({
        next: (v) => (this.allCommittees.set(v), this.committeesLoaded.set(true)),
        error: () => (fail(), this.committeesLoaded.set(true)),
      });
    }
  }

  private listOf(field: ChangeField): ChoiceList | null {
    if (field === 'typeValueId') return 'types';
    if (field === 'orgUnitId') return 'units';
    if (field === 'parentCommitteeId' || field === 'reportingToCommitteeId') return 'committees';
    return null;
  }

  private referenceList(chain: 'parent' | 'reportsTo') {
    this.translate.currentLang();
    const c = this.committee();
    const saved = chain === 'parent' ? c?.parentCommitteeId : c?.reportingToCommitteeId;
    return referenceOptions(this.allCommittees(), c?.id ?? null, chain, saved ?? null).map((r) => ({
      ...r,
      label: this.language.bilingual(r.nameEn, r.nameAr),
    }));
  }

  labelOf(field: ChangeField): string {
    const keys: Record<ChangeField, string> = {
      nameEn: 'committee.nameEn',
      nameAr: 'committee.nameAr',
      typeValueId: 'committee.type',
      purpose: 'committee.purpose',
      quorumCount: 'committee.quorumCount',
      meetingFrequency: 'committee.meetingFrequency',
      orgUnitId: 'committee.owningUnit',
      parentCommitteeId: 'committee.parentCommittee',
      reportingToCommitteeId: 'committee.reportingTo',
    };
    return keys[field];
  }

  isChanged(field: ChangeField): boolean {
    return field in this.changes();
  }

  /** "Current", or "was …" once changed — and, for the quorum, how many members it is out of. */
  hintFor(field: ChangeField): string {
    this.translate.currentLang();
    const list = this.listOf(field);
    if (list && this.failedLists().has(list)) return this.translate.instant('committee.form.listFailed');
    const c = this.committee() as unknown as Record<ChangeField, ChangeValue> | null;
    const base = this.isChanged(field)
      ? this.translate.instant('committee.changeRequest.form.was', { value: this.text.value(field, c?.[field] ?? null, this.labels()) })
      : this.translate.instant('committee.changeRequest.form.current');
    const members = this.memberCount();
    return field === 'quorumCount' && members !== null ? `${base} · ${this.format.count('committee.changeRequestOfMembers', members)}` : base;
  }

  retryFor(field: ChangeField): { label: string; run: () => void } | null {
    const list = this.listOf(field);
    if (!list || !this.failedLists().has(list)) return null;
    let action = this.retryActions.get(list);
    if (!action) {
      const translate = this.translate;
      action = {
        get label() {
          return translate.instant('common.retry');
        },
        run: () => this.loadList(list),
      };
      this.retryActions.set(list, action);
    }
    return action;
  }

  errorKeys(field: ChangeField): Record<string, string> {
    const own: Record<string, string> =
      field === 'nameEn'
        ? { required: 'committee.form.nameRequired' }
        : field === 'typeValueId'
          ? { required: 'committee.form.typeRequired' }
          : field === 'orgUnitId'
            ? { required: 'committee.refusal.unitRequired' }
            : field === 'quorumCount'
              ? { required: 'committee.changeRequest.refusal.CHANGE_REQUEST_QUORUM_MIN', min: 'committee.changeRequest.refusal.CHANGE_REQUEST_QUORUM_MIN' }
              : {};
    const refused = this.refusedField();
    return refused && refused.field === field ? { ...own, refused: refused.text } : own;
  }

  retryPreview(): void {
    this.previewRetry.update((n) => n + 1);
  }

  /** Save as draft (`submit` false) or Submit for review. Never disabled: an incomplete form says why. */
  save(submit: boolean): void {
    if (this.saving()) return;
    this.lastSubmit = submit;
    const changes = this.changes();
    const nothing = Object.keys(changes).length === 0;
    this.noChanges.set(nothing);
    if (nothing || this.form.invalid) {
      this.showErrors.set(true);
      this.footer.set(null);
      this.focusFirstProblem(nothing);
      return;
    }
    this.saving.set(true);
    this.footer.set(null);
    const reason = this.form.controls.reason.value!.trim();
    const request = this.request();
    const saved$: Observable<ChangeRequestDto> = request
      ? this.changeRequests
          .update(request.id, { changes: this.fullProposal(changes), reason, expectedUpdatedAt: request.updatedAt })
          .pipe(
            tap((r) => this.request.set(r)),
            switchMap((r) => (submit ? this.changeRequests.submit(r.id) : of(r))),
          )
      : this.changeRequests.create(this.committeeId, { changes, reason, submit });
    saved$.subscribe({
      next: (r) => {
        this.saving.set(false);
        this.done = true;
        this.form.markAsPristine();
        void this.router.navigate(this.requestLink(r.id));
      },
      error: (err: unknown) => {
        this.saving.set(false);
        this.failed(err);
      },
    });
  }

  /**
   * An edit sends every field it shows: one that went back to today's value
   * must reach the server as today's value, so the draft stops proposing it.
   */
  private fullProposal(changes: ChangeValues): ChangeValues {
    const committee = this.committee() as unknown as Record<ChangeField, ChangeValue>;
    const out: ChangeValues = { ...changes };
    for (const field of Object.keys(this.request()?.changes ?? {}) as ChangeField[]) {
      if (!(field in out) && CHANGE_FIELDS.includes(field)) out[field] = committee[field] ?? null;
    }
    return out;
  }

  private failed(err: unknown): void {
    const refusal = this.text.refusal(err, this.request()?.number ?? null);
    if (refusal.code === 'CHANGE_REQUEST_ALREADY_OPEN') {
      // Someone opened one first: take the reader to it.
      this.changeRequests.open(this.committeeId).subscribe({
        next: (open) => {
          if (open.request) {
            this.done = true;
            void this.router.navigate(this.requestLink(open.request.id), { replaceUrl: true });
          } else this.footer.set({ text: refusal.text, retry: false, reload: false });
        },
        error: () => this.footer.set({ text: refusal.text, retry: false, reload: false }),
      });
      return;
    }
    if (refusal.code === 'CHANGE_REQUEST_NO_CHANGES') {
      this.noChanges.set(true);
      this.focusFirstProblem(true);
      return;
    }
    if (refusal.field) {
      this.refuse(refusal.field, refusal.text);
      this.focusFirstProblem(false);
      return;
    }
    this.footer.set({ text: refusal.text, retry: refusal.retry, reload: refusal.reload });
  }

  /** The draft changed elsewhere: read it again and show what is saved now. */
  reload(): void {
    this.load();
  }

  private refuse(field: ChangeField, text: string): void {
    this.refusedField.set({ field, text });
    const control: AbstractControl = this.form.controls[field];
    control.setErrors({ ...(control.errors ?? {}), refused: true });
    this.showErrors.set(true);
  }

  private clearRefusal(): void {
    const refused = this.refusedField();
    if (!refused) return;
    this.refusedField.set(null);
    this.form.controls[refused.field].updateValueAndValidity({ emitEvent: false });
  }

  private focusFirstProblem(nothingChanged: boolean): void {
    setTimeout(() => {
      const root = this.host.nativeElement;
      if (nothingChanged) {
        root.querySelector<HTMLElement>('[data-testid="crf-no-changes"]')?.focus();
        return;
      }
      const order = [...CHANGE_FIELDS, 'reason'] as const;
      const first = order.find((f) => this.form.controls[f].invalid);
      root.querySelector(`[data-crf-field="${first}"]`)?.querySelector<HTMLElement>('input, textarea, button, [tabindex="0"]')?.focus();
    });
  }

  cancel(): void {
    const r = this.request();
    void this.router.navigate(r ? this.requestLink(r.id) : ['/committees', this.committeeId]);
  }

  private requestLink(id: string): string[] {
    return ['/committees', this.committeeId, 'change-requests', id];
  }

  /** Leaving with unsaved work asks Keep editing · Discard, as the Edit dialog does. */
  canLeave(): boolean | Promise<boolean> {
    if (this.done || !this.form.dirty) return true;
    return new Promise<boolean>((resolve) => {
      this.confirm.ask({
        tone: 'destructive',
        header: this.translate.instant('dialog.discardHeader'),
        message: this.translate.instant('dialog.discardMessage'),
        acceptLabel: this.translate.instant('dialog.discard'),
        rejectLabel: this.translate.instant('dialog.keepEditing'),
        accept: () => resolve(true),
        reject: () => resolve(false),
      });
    });
  }

  @HostListener('window:beforeunload', ['$event'])
  onBeforeUnload(event: BeforeUnloadEvent): void {
    if (this.done || !this.form.dirty) return;
    event.preventDefault();
    event.returnValue = '';
  }
}
