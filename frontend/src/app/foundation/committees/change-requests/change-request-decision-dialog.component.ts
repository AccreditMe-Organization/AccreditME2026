import { Component, computed, effect, inject, input, output, signal, untracked, viewChild } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Observable } from 'rxjs';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { ButtonModule } from 'primeng/button';
import { TextareaModule } from 'primeng/textarea';
import { FormatService } from '../../../core/formatting';
import { EditDialogComponent } from '../../../shared/components/edit-dialog/edit-dialog.component';
import { FieldComponent } from '../../../shared/components/field/field.component';
import { ChangeRequestText } from './change-request-text';
import { ChangeRequestDto, ChangeRequestService } from './change-request.service';

export type ChangeRequestDecision = 'return' | 'reject';

/**
 * ACC-240 — Return for changes and Reject (plan §3.4): a 560 form, its one
 * field required. The action is never disabled (rule 5.2): pressed with an
 * empty note, the slot says what is missing. Reject's action is the danger
 * one. A refusal is said from its code inside the dialog; Retry only when the
 * server could not be reached (rule 5.5). A typed note asks Keep editing ·
 * Discard on Cancel or Escape (`[dirty]`).
 */
@Component({
  selector: 'am-change-request-decision-dialog',
  standalone: true,
  imports: [ReactiveFormsModule, TranslatePipe, ButtonModule, TextareaModule, EditDialogComponent, FieldComponent],
  template: `
    <ng-template #bodyTpl>
      <form [formGroup]="form" (ngSubmit)="decide()" class="am-crd" data-crd-body>
        <p class="am-crd__sentence">{{ sentence() }}</p>
        <am-field
          [label]="'committee.changeRequest.' + kind() + '.' + (kind() === 'return' ? 'note' : 'reason') | translate"
          [control]="form.controls.note"
          inputId="crd-note"
          [forceShowErrors]="showErrors()"
          [errorMessages]="{ required: requiredKey(), pattern: requiredKey() }"
        >
          <textarea pTextarea id="crd-note" formControlName="note" rows="4" maxlength="1000"></textarea>
        </am-field>
      </form>
    </ng-template>

    <ng-template #footerTpl>
      <div class="am-crd__foot">
        @if (refusal(); as r) {
          <p class="am-crd__message" role="alert" data-testid="crd-refusal">{{ r }}</p>
        }
        <div class="am-crd__buttons">
          <p-button type="button" [label]="'common.cancel' | translate" severity="secondary" [text]="true" [disabled]="saving()" (onClick)="dialog().requestClose()" />
          @if (retry()) {
            <p-button type="button" [label]="'list.retry' | translate" [loading]="saving()" (onClick)="decide()" data-testid="crd-retry" />
          } @else {
            <p-button
              type="button"
              [label]="'committee.changeRequest.' + kind() + '.button' | translate"
              [severity]="kind() === 'reject' ? 'danger' : undefined"
              [loading]="saving()"
              (onClick)="decide()"
              data-testid="crd-decide"
            />
          }
        </div>
      </div>
    </ng-template>

    <app-edit-dialog
      [visible]="visible()"
      (visibleChange)="visibleChange.emit($event)"
      [header]="header()"
      [context]="context()"
      [content]="bodyTpl"
      [footer]="footerTpl"
      [dirty]="form.dirty"
      [saving]="saving()"
      size="form"
    />
  `,
  styles: [
    `
      .am-crd{display:flex;flex-direction:column;gap:var(--am-space-12);min-inline-size:0}
      .am-crd__sentence{margin:0;color:var(--am-ink-700)}
      .am-crd__foot{display:flex;align-items:center;justify-content:space-between;gap:var(--am-space-12);inline-size:100%}
      .am-crd__message{margin:0;font-size:var(--am-type-meta-size);color:var(--am-danger-ink);min-inline-size:0}
      .am-crd__buttons{display:flex;gap:var(--am-space-12);flex:none;margin-inline-start:auto}
    `,
  ],
})
export class ChangeRequestDecisionDialogComponent {
  private readonly fb = inject(FormBuilder);
  private readonly service = inject(ChangeRequestService);
  private readonly text = inject(ChangeRequestText);
  private readonly translate = inject(TranslateService);
  private readonly format = inject(FormatService);
  protected readonly dialog = viewChild.required(EditDialogComponent);

  readonly kind = input.required<ChangeRequestDecision>();
  readonly request = input.required<ChangeRequestDto>();
  /** The committee's name, already in the reader's language. */
  readonly committeeName = input('');
  readonly visible = input(false);
  readonly visibleChange = output<boolean>();
  readonly decided = output<ChangeRequestDto>();

  readonly saving = signal(false);
  readonly showErrors = signal(false);
  readonly refusal = signal<string | null>(null);
  readonly retry = signal(false);

  readonly form = this.fb.group({ note: ['', [Validators.required, Validators.pattern(/\S/), Validators.maxLength(1000)]] });

  readonly requiredKey = computed(() => (this.kind() === 'return' ? 'committee.changeRequest.return.noteRequired' : 'committee.changeRequest.reject.reasonRequired'));

  readonly header = computed(() => {
    this.translate.currentLang();
    return this.translate.instant(`committee.changeRequest.${this.kind()}.header`, { n: this.format.number(this.request().number) });
  });

  readonly context = computed(() => {
    this.translate.currentLang();
    const r = this.request();
    return this.kind() === 'return'
      ? this.translate.instant('committee.changeRequest.return.context', { n: this.format.number(r.number), name: r.requestedBy.name })
      : this.translate.instant('committee.changeRequest.reject.context');
  });

  readonly sentence = computed(() => {
    this.translate.currentLang();
    return this.translate.instant(`committee.changeRequest.${this.kind()}.sentence`, { name: this.request().requestedBy.name });
  });

  constructor() {
    // Each opening starts empty.
    effect(() => {
      if (!this.visible()) return;
      untracked(() => {
        this.form.reset({ note: '' });
        this.showErrors.set(false);
        this.refusal.set(null);
        this.retry.set(false);
        this.saving.set(false);
      });
    });
  }

  decide(): void {
    if (this.saving()) return;
    if (this.form.invalid) {
      this.showErrors.set(true);
      setTimeout(() => document.getElementById('crd-note')?.focus());
      return;
    }
    this.saving.set(true);
    this.refusal.set(null);
    const note = this.form.controls.note.value!.trim();
    const id = this.request().id;
    const call: Observable<ChangeRequestDto> = this.kind() === 'return' ? this.service.returnForChanges(id, note) : this.service.reject(id, note);
    call.subscribe({
      next: (r) => {
        this.saving.set(false);
        this.form.markAsPristine();
        this.decided.emit(r);
        this.visibleChange.emit(false);
      },
      error: (err: unknown) => {
        this.saving.set(false);
        const said = this.text.refusal(err, this.request().number);
        this.refusal.set(said.text);
        this.retry.set(said.retry);
      },
    });
  }
}
