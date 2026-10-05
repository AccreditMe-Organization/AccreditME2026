import { Component, effect, inject, input, output, signal } from '@angular/core';
import { AbstractControl, FormBuilder, ReactiveFormsModule, ValidationErrors, Validators } from '@angular/forms';
import { TranslatePipe } from '@ngx-translate/core';
import { ButtonModule } from 'primeng/button';
import { InputTextModule } from 'primeng/inputtext';
import { EditDialogComponent } from '../../../../shared/components/edit-dialog/edit-dialog.component';
import { FieldComponent } from '../../../../shared/components/field/field.component';
import { extractErrorMessage } from '../../../../shared/utils/http-error.util';
import { ITaskDto, TaskService } from '../../services/task.service';

// http or https, then something that is not a space. The server's rule is
// stricter (a real URL); this one only catches what a person can see is wrong
// before sending — above all a link with no protocol, or a pasted
// `javascript:`, which the server refuses because the link is rendered
// clickable for whoever reviews the task.
const HTTP_URL = /^https?:\/\/\S+$/i;

// Judged on the TRIMMED value, which is what is sent: a link pasted with a
// trailing space is a valid link, and refusing it with "must start with
// https://" would describe a fault it does not have. Reported as `pattern`,
// so the field's message is the one written for this rule.
function httpUrl(control: AbstractControl): ValidationErrors | null {
  const value = typeof control.value === 'string' ? control.value.trim() : '';
  return !value || HTTP_URL.test(value) ? null : { pattern: true };
}

/**
 * Add link evidence — ACC-163 (Q11).
 *
 * New evidence is a link or a reference to a record. A note is a comment, not
 * proof, and file attachments wait for the storage tickets — so this is the
 * one evidence form there is.
 *
 * ## Body height — two fields, 79 + 79 + 12 = 170 against the 420 cap
 *
 * FORM density: two blocks, far from five.
 */
@Component({
  selector: 'app-task-link-evidence-dialog',
  standalone: true,
  imports: [ReactiveFormsModule, TranslatePipe, ButtonModule, InputTextModule, EditDialogComponent, FieldComponent],
  template: `
    <ng-template #bodyTpl>
      <form [formGroup]="form" (ngSubmit)="submit()" class="flex flex-col gap-3">
        <am-field
          [label]="'task.linkUrl' | translate"
          [control]="form.controls.url"
          [hint]="'task.linkUrlHint' | translate"
          [forceShowErrors]="showErrors()"
          [errorMessages]="{ pattern: 'task.linkUrlInvalid', maxlength: 'validation.maxLength' }"
        >
          <!-- dir="ltr": a URL is Latin script and reads left to right in an
               Arabic layout too, or its parts reorder. -->
          <input pInputText id="taskLinkUrl" type="url" dir="ltr" formControlName="url" autocomplete="off" />
        </am-field>
        <am-field
          [label]="'task.linkTitle' | translate"
          [control]="form.controls.linkTitle"
          [hint]="'task.linkTitleHint' | translate"
          [forceShowErrors]="showErrors()"
          [errorMessages]="{ maxlength: 'validation.maxLength255' }"
        >
          <input pInputText id="taskLinkTitle" formControlName="linkTitle" autocomplete="off" />
        </am-field>
        @if (error()) {
          <p class="text-meta text-[var(--am-danger-ink)]" role="alert">{{ error()! | translate }}</p>
        }
      </form>
    </ng-template>
    <ng-template #footerTpl>
      <div class="flex justify-end gap-3">
        <p-button
          [label]="'common.cancel' | translate"
          severity="secondary"
          [text]="true"
          type="button"
          [disabled]="saving()"
          (onClick)="dialog.requestClose()"
        />
        <p-button
          type="button"
          [label]="'task.addLink' | translate"
          [loading]="saving()"
          (onClick)="submit()"
        />
      </div>
    </ng-template>
    <app-edit-dialog
      #dialog
      [visible]="visible()"
      (visibleChange)="visibleChange.emit($event)"
      [header]="'task.addLinkNamed' | translate: { title: task()?.title ?? '' }"
      [content]="bodyTpl"
      [footer]="footerTpl"
      [dirty]="form.dirty"
      [saving]="saving()"
      size="form"
    />
  `,
})
export class TaskLinkEvidenceDialogComponent {
  private readonly fb = inject(FormBuilder);
  private readonly taskService = inject(TaskService);

  readonly visible = input.required<boolean>();
  readonly task = input<ITaskDto | null>(null);
  readonly visibleChange = output<boolean>();
  /** Emitted once the link is saved; the host reloads its list. */
  readonly added = output<void>();

  readonly saving = signal(false);
  readonly error = signal<string | null>(null);
  readonly showErrors = signal(false);

  readonly form = this.fb.group({
    url: ['', [Validators.required, httpUrl, Validators.maxLength(2000)]],
    linkTitle: ['', [Validators.maxLength(255)]],
  });

  constructor() {
    effect(() => {
      if (this.visible()) {
        this.form.reset({ url: '', linkTitle: '' });
        this.error.set(null);
        this.showErrors.set(false);
      }
    });
  }

  submit(): void {
    const task = this.task();
    if (!task || this.saving()) return;
    if (this.form.invalid) {
      this.showErrors.set(true);
      return;
    }
    const { url, linkTitle } = this.form.getRawValue();
    this.saving.set(true);
    this.error.set(null);
    this.taskService
      .addEvidence(task.id, { type: 'LINK', url: url!.trim(), linkTitle: linkTitle?.trim() || undefined })
      .subscribe({
        next: () => {
          this.saving.set(false);
          this.form.markAsPristine();
          this.added.emit();
          this.visibleChange.emit(false);
        },
        error: (err: unknown) => {
          this.saving.set(false);
          this.error.set(extractErrorMessage(err, 'task.errorAction'));
        },
      });
  }
}
