import { Component, computed, effect, inject, input, output, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { ButtonModule } from 'primeng/button';
import { TextareaModule } from 'primeng/textarea';
import { EditDialogComponent } from '../../../../shared/components/edit-dialog/edit-dialog.component';
import { FieldComponent } from '../../../../shared/components/field/field.component';
import { FormatService } from '../../../../core/formatting';
import { extractErrorMessage } from '../../../../shared/utils/http-error.util';
import { TaskRequestForDecisionDto, TaskService } from '../../services/task.service';

/**
 * Decide a request for more time or a hold — ACC-173.
 *
 * APPROVE MEANS APPROVE AS ASKED. There is no counter-proposal: a decider who
 * wants a different date declines with a note, and the assignee asks again.
 * So the dialog shows exactly what was asked, and offers one note field —
 * optional for Approve, REQUIRED for Decline, because the person who asked
 * reads it.
 *
 * ## Body height — measured in the browser pass, recorded on the PR.
 */
@Component({
  selector: 'app-task-request-decision-dialog',
  standalone: true,
  imports: [ReactiveFormsModule, TranslatePipe, ButtonModule, TextareaModule, EditDialogComponent, FieldComponent],
  template: `
    <ng-template #bodyTpl>
      @if (request(); as r) {
        <form [formGroup]="form" class="flex flex-col">
          <div class="am-decision-strip">
            <span class="am-decision-strip__label">{{ askedLabel() | translate }}</span>
            <span class="am-decision-strip__body">
              <span class="am-decision-strip__value">{{ askedLine() }}</span>
              <span class="am-decision-strip__reason">{{ 'task.request.reasonQuoted' | translate: { reason: r.reason } }}</span>
            </span>
          </div>

          <am-field
            [label]="'task.request.decisionNote' | translate"
            [control]="form.controls.note"
            [hint]="'task.request.decisionNoteHint' | translate"
            [forceShowErrors]="showErrors()"
            [errorMessages]="{ required: 'task.request.declineNeedsNote', maxlength: 'task.rejectReasonTooLong' }"
          >
            <textarea pTextarea id="taskRequestDecisionNote" formControlName="note" rows="3"></textarea>
          </am-field>

          @if (error()) {
            <p class="text-meta text-[var(--am-danger-ink)]" role="alert">{{ error()! | translate }}</p>
          }
        </form>
      }
    </ng-template>
    <ng-template #footerTpl>
      <div class="flex justify-end gap-3">
        <p-button
          [label]="'common.cancel' | translate"
          severity="secondary"
          [text]="true"
          type="button"
          [disabled]="saving() !== null"
          (onClick)="dialog.requestClose()"
        />
        <p-button
          type="button"
          severity="danger"
          [outlined]="true"
          [label]="'task.request.decline' | translate"
          [loading]="saving() === 'decline'"
          [disabled]="saving() !== null"
          (onClick)="decline()"
        />
        <p-button
          type="button"
          [label]="'task.request.approve' | translate"
          [loading]="saving() === 'approve'"
          [disabled]="saving() !== null"
          (onClick)="approve()"
        />
      </div>
    </ng-template>
    <app-edit-dialog
      #dialog
      [visible]="visible()"
      (visibleChange)="visibleChange.emit($event)"
      [header]="'task.request.reviewNamed' | translate: { title: request()?.task?.title ?? '' }"
      [content]="bodyTpl"
      [footer]="footerTpl"
      [dirty]="form.dirty"
      [saving]="saving() !== null"
      size="form"
    />
  `,
  styles: [
    `
      .am-decision-strip {
        display: flex;
        gap: var(--am-space-8);
        align-items: flex-start;
        padding: var(--am-space-8) 0;
        margin-block-end: var(--am-space-12);
        border-block: 1px solid var(--am-border);
      }
      .am-decision-strip__label {
        flex: none;
        font-size: var(--am-type-micro-size);
        line-height: var(--am-type-meta-line);
        font-weight: 700;
        letter-spacing: 0.05em;
        text-transform: uppercase;
        color: var(--am-ink-500);
      }
      .am-decision-strip__body {
        flex: 1 1 auto;
        min-width: 0;
        display: flex;
        flex-direction: column;
        gap: 2px;
      }
      .am-decision-strip__value {
        font-size: var(--am-type-meta-size);
        line-height: var(--am-type-meta-line);
        font-weight: 600;
        color: var(--am-ink-900);
      }
      .am-decision-strip__reason {
        font-size: var(--am-type-meta-size);
        line-height: var(--am-type-meta-line);
        color: var(--am-ink-700);
        overflow-wrap: anywhere;
      }
    `,
  ],
})
export class TaskRequestDecisionDialogComponent {
  private readonly fb = inject(FormBuilder);
  private readonly taskService = inject(TaskService);
  private readonly format = inject(FormatService);
  private readonly translate = inject(TranslateService);

  readonly visible = input.required<boolean>();
  readonly request = input<TaskRequestForDecisionDto | null>(null);
  readonly visibleChange = output<boolean>();
  /** Emitted once decided either way; the host reloads its lists. */
  readonly decided = output<void>();

  readonly saving = signal<'approve' | 'decline' | null>(null);
  readonly error = signal<string | null>(null);
  readonly showErrors = signal(false);

  readonly form = this.fb.group({ note: ['', [Validators.maxLength(1000)]] });

  readonly askedLabel = computed(() =>
    this.request()?.type === 'ON_HOLD' ? 'task.request.holdRequested' : 'task.request.extensionRequested',
  );

  /** "Sara asks for 20 Oct 2026, 13:00" / "Sara asks to hold it until 25 Oct 2026". */
  readonly askedLine = computed(() => {
    const r = this.request();
    if (!r) return '';
    return r.type === 'ON_HOLD'
      ? this.translate.instant('task.request.askedHold', { name: r.requestedByName, date: this.format.date(r.holdUntil) })
      : this.translate.instant('task.request.askedExtension', {
          name: r.requestedByName,
          date: this.format.dateTime(r.requestedDueAt),
        });
  });

  constructor() {
    effect(() => {
      if (!this.visible()) return;
      this.form.reset({ note: '' });
      this.form.controls.note.setValidators([Validators.maxLength(1000)]);
      this.form.controls.note.updateValueAndValidity();
      this.error.set(null);
      this.showErrors.set(false);
    });
  }

  approve(): void {
    const r = this.request();
    if (!r || this.saving()) return;
    // The note is optional here — only its length is checked.
    this.form.controls.note.setValidators([Validators.maxLength(1000)]);
    this.form.controls.note.updateValueAndValidity();
    if (this.form.invalid) {
      this.showErrors.set(true);
      return;
    }
    const note = this.form.getRawValue().note?.trim() || undefined;
    this.run('approve', this.taskService.approveRequest(r.task.id, r.id, note));
  }

  decline(): void {
    const r = this.request();
    if (!r || this.saving()) return;
    // A decline says why: the note becomes required, whitespace included.
    this.form.controls.note.setValidators([
      Validators.maxLength(1000),
      (c) => (typeof c.value === 'string' && c.value.trim() ? null : { required: true }),
    ]);
    this.form.controls.note.updateValueAndValidity();
    if (this.form.invalid) {
      this.showErrors.set(true);
      return;
    }
    this.run('decline', this.taskService.declineRequest(r.task.id, r.id, this.form.getRawValue().note!.trim()));
  }

  private run(kind: 'approve' | 'decline', request: ReturnType<TaskService['approveRequest']>): void {
    this.saving.set(kind);
    this.error.set(null);
    request.subscribe({
      next: () => {
        this.saving.set(null);
        this.form.markAsPristine();
        this.decided.emit();
        this.visibleChange.emit(false);
      },
      error: (err: unknown) => {
        this.saving.set(null);
        this.error.set(extractErrorMessage(err, 'task.errorAction'));
      },
    });
  }
}
