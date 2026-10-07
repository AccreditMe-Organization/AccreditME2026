import { Component, computed, effect, inject, input, output, signal, untracked } from '@angular/core';
import { HttpEventType } from '@angular/common/http';
import { AbstractControl, FormBuilder, ReactiveFormsModule, ValidationErrors, Validators } from '@angular/forms';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { ButtonModule } from 'primeng/button';
import { InputTextModule } from 'primeng/inputtext';
import { EditDialogComponent } from '../../../../shared/components/edit-dialog/edit-dialog.component';
import { FieldComponent } from '../../../../shared/components/field/field.component';
import { IconButtonComponent } from '../../../../shared/components/icon-button/icon-button.component';
import { extractErrorMessage } from '../../../../shared/utils/http-error.util';
import { acceptAttribute, extensionOf, FilesService, IUploadLimitsDto } from '../../../../shared/files/files.service';
import { FormatService } from '../../../../core/formatting';
import { ITaskDto, TaskService } from '../../services/task.service';

// http or https, then something that is not a space — the screen's half of the
// server's rule (a link is rendered clickable for whoever reviews the task).
const HTTP_URL = /^https?:\/\/\S+$/i;

function httpUrl(control: AbstractControl): ValidationErrors | null {
  const value = typeof control.value === 'string' ? control.value.trim() : '';
  return !value || HTTP_URL.test(value) ? null : { pattern: true };
}

/** At most three files in one go (the drawing's "up to 3 at a time"). */
export const MAX_FILES_AT_A_TIME = 3;

export type EvidenceKind = 'LINK' | 'FILE';

type QueuedState = 'ready' | 'uploading' | 'added' | 'refused';

export interface QueuedFile {
  id: number;
  file: File;
  state: QueuedState;
  /** 0–100 while uploading. */
  progress: number;
  /** Why it was refused, in the reader's language. */
  reason: string | null;
}

/**
 * Add evidence — ACC-177, the accepted drawing's "Add evidence" (Task Screens,
 * §5, the three Add evidence frames).
 *
 * ONE dialog for every kind of evidence, kind first. The drawing has three
 * kinds — Link, Record, File — and Record is "decided, no screen yet": the
 * product has no record picker, so it is ABSENT here rather than a disabled
 * segment, and Kind has two. When the record picker exists it is a third
 * segment and nothing else moves.
 *
 * THE SLOT IS HELD TO THE TALLEST KIND (File, with three file rows), so
 * switching kind never moves the footer. Measured in the browser, both
 * languages — see `.am-evidence-slot` below.
 *
 * Files are checked here before anything is sent (type and size, from the
 * installation's own limits), so a file that cannot be accepted says so at
 * once; the server checks again, from the content, and its refusal wins.
 * Each file is one request, one after another, with its own progress.
 */
@Component({
  selector: 'app-task-add-evidence-dialog',
  standalone: true,
  imports: [ReactiveFormsModule, TranslatePipe, ButtonModule, InputTextModule, EditDialogComponent, FieldComponent, IconButtonComponent],
  template: `
    <ng-template #bodyTpl>
      <div class="flex flex-col gap-3">
        <div class="flex flex-col gap-1">
          <span class="text-label font-medium text-[var(--am-ink-700)]" id="evidenceKindLabel">{{ 'task.evidence.kind' | translate }}</span>
          <div role="group" aria-labelledby="evidenceKindLabel" class="am-segmented">
            @for (option of kinds; track option.value) {
              <button
                type="button"
                class="am-segmented__option"
                [class.am-segmented__option--active]="kind() === option.value"
                [attr.aria-pressed]="kind() === option.value"
                [disabled]="busy()"
                (click)="chooseKind(option.value)"
              >
                {{ option.labelKey | translate }}
              </button>
            }
          </div>
        </div>

        <div class="am-evidence-slot">
          @if (kind() === 'LINK') {
            <form [formGroup]="linkForm" (ngSubmit)="submit()" class="flex flex-col gap-3">
              <am-field
                [label]="'task.linkUrl' | translate"
                [control]="linkForm.controls.url"
                [hint]="'task.linkUrlHint' | translate"
                [forceShowErrors]="showErrors()"
                [errorMessages]="{ pattern: 'task.linkUrlInvalid', maxlength: 'validation.maxLength' }"
              >
                <!-- dir="ltr": a URL reads left to right in an Arabic layout too. -->
                <input pInputText id="evidenceLinkUrl" type="url" dir="ltr" formControlName="url" autocomplete="off" />
              </am-field>
              <am-field
                [label]="'task.linkTitle' | translate"
                [control]="linkForm.controls.linkTitle"
                [hint]="'task.linkTitleHint' | translate"
                [forceShowErrors]="showErrors()"
                [errorMessages]="{ maxlength: 'validation.maxLength255' }"
              >
                <input pInputText id="evidenceLinkTitle" formControlName="linkTitle" autocomplete="off" />
              </am-field>
            </form>
          } @else {
            <div
              class="am-dropzone"
              [class.am-dropzone--over]="dragOver()"
              role="button"
              tabindex="0"
              [attr.aria-label]="'task.evidence.dropAria' | translate"
              [attr.aria-describedby]="'evidenceLimits'"
              (click)="fileInput.click()"
              (keydown.enter)="fileInput.click()"
              (keydown.space)="$event.preventDefault(); fileInput.click()"
              (dragover)="onDragOver($event)"
              (dragleave)="dragOver.set(false)"
              (drop)="onDrop($event)"
            >
              <span class="text-body text-[var(--am-ink-900)]">
                {{ 'task.evidence.dropLead' | translate }}
                <span class="am-dropzone__browse">{{ 'task.evidence.browse' | translate }}</span>
              </span>
              <span id="evidenceLimits" class="text-meta text-[var(--am-ink-500)]">{{ limitsLine() }}</span>
            </div>
            <input
              #fileInput
              type="file"
              class="hidden"
              multiple
              [attr.accept]="accept()"
              (change)="onPicked(fileInput)"
            />
            @if (queue().length) {
              <ul class="am-file-rows" [attr.aria-label]="'task.evidence.chosenFiles' | translate">
                @for (item of queue(); track item.id) {
                  <li class="am-file-row" [class.am-file-row--refused]="item.state === 'refused'">
                    <i class="pi pi-file am-file-row__glyph" aria-hidden="true"></i>
                    <span class="am-file-row__main">
                      <span class="am-file-row__name" dir="auto" [attr.title]="item.file.name">{{ item.file.name }}</span>
                      @if (item.state === 'uploading') {
                        <span class="am-file-row__bar" role="progressbar" [attr.aria-valuenow]="item.progress" aria-valuemin="0" aria-valuemax="100" [attr.aria-label]="item.file.name">
                          <span class="am-file-row__fill" [style.inline-size.%]="item.progress"></span>
                        </span>
                      }
                    </span>
                    <span class="am-file-row__state" [class.am-file-row__state--refused]="item.state === 'refused'">{{ stateLine(item) }}</span>
                    @if (item.state === 'ready' || item.state === 'refused') {
                      <am-icon-button
                        icon="pi pi-times"
                        [label]="'task.evidence.removeChosen' | translate: { name: item.file.name }"
                        [disabled]="busy()"
                        (activated)="unqueue(item)"
                      />
                    }
                  </li>
                }
              </ul>
            }
          }
        </div>
        @if (error()) {
          <p class="text-meta text-[var(--am-danger-ink)]" role="alert">{{ error() }}</p>
        }
      </div>
    </ng-template>
    <ng-template #footerTpl>
      <div class="flex justify-end gap-3">
        <p-button
          [label]="'common.cancel' | translate"
          severity="secondary"
          [text]="true"
          type="button"
          [disabled]="busy()"
          (onClick)="dialog.requestClose()"
        />
        <p-button type="button" [label]="primaryLabel()" [loading]="busy()" (onClick)="submit()" />
      </div>
    </ng-template>
    <app-edit-dialog
      #dialog
      [visible]="visible()"
      (visibleChange)="visibleChange.emit($event)"
      [header]="'task.evidence.addTitle' | translate"
      [context]="contextLine()"
      [content]="bodyTpl"
      [footer]="footerTpl"
      [dirty]="dirty()"
      [saving]="busy()"
      size="form"
    />
  `,
  styles: [
    `
      .am-segmented {
        display: inline-flex;
        align-self: flex-start;
        overflow: hidden;
        border: 1px solid var(--am-control-border);
        border-radius: var(--am-radius-button);
      }
      .am-segmented__option {
        min-block-size: var(--am-control-height);
        padding-inline: var(--am-space-16);
        font-size: var(--am-type-value-size);
        font-weight: 500;
        color: var(--am-ink-700);
        background: var(--am-control-bg);
        border: none;
        cursor: pointer;
      }
      .am-segmented__option + .am-segmented__option {
        border-inline-start: 1px solid var(--am-control-border);
      }
      .am-segmented__option:hover:not(:disabled) {
        background: var(--am-primary-50);
      }
      .am-segmented__option--active,
      .am-segmented__option--active:hover:not(:disabled) {
        color: var(--am-control-bg);
        background: var(--am-primary-600);
      }
      .am-segmented__option:focus-visible {
        outline: var(--am-focus-ring-width) solid var(--am-focus-ring);
        outline-offset: var(--am-focus-ring-offset);
      }

      /* Held to the tallest kind — File with three rows — so switching kind
         never moves the footer (the drawing's "slot"). Measured in the browser
         (7 Oct 2026, 1440x900), File view with three rows and their refusals:
         English 245, Arabic 251 (the limits line wraps); Link view 176 / 186.
         Body with the slot held: 339 English, 342 Arabic, against the 420 cap. */
      .am-evidence-slot {
        min-block-size: 268px;
      }

      .am-dropzone {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: var(--am-space-6);
        min-block-size: 112px;
        padding: var(--am-space-16);
        text-align: center;
        border: 1px dashed var(--am-control-border);
        border-radius: var(--am-radius-card);
        background: var(--am-surface);
        cursor: pointer;
      }
      .am-dropzone:hover,
      .am-dropzone--over {
        border-color: var(--am-primary-600);
        background: var(--am-primary-50);
      }
      .am-dropzone:focus-visible {
        outline: var(--am-focus-ring-width) solid var(--am-focus-ring);
        outline-offset: var(--am-focus-ring-offset);
      }
      .am-dropzone__browse {
        color: var(--am-primary-600);
        font-weight: 600;
        text-decoration: underline;
      }

      .am-file-rows {
        list-style: none;
        margin: var(--am-space-12) 0 0;
        padding: 0;
        display: flex;
        flex-direction: column;
      }
      .am-file-row {
        display: flex;
        align-items: center;
        gap: var(--am-space-8);
        min-block-size: var(--am-icon-button-size);
        padding-block: var(--am-space-4);
        border-block-end: 1px solid var(--am-row-rule);
      }
      .am-file-row__glyph {
        color: var(--am-ink-500);
      }
      .am-file-row__main {
        flex: 1 1 auto;
        min-inline-size: 0;
        display: flex;
        flex-direction: column;
        gap: var(--am-space-4);
      }
      .am-file-row__name {
        font-size: var(--am-type-value-size);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .am-file-row__bar {
        display: block;
        block-size: var(--am-space-4);
        border-radius: var(--am-radius-pill);
        background: var(--am-border);
        overflow: hidden;
      }
      .am-file-row__fill {
        display: block;
        block-size: 100%;
        background: var(--am-primary-600);
      }
      .am-file-row__state {
        flex: none;
        max-inline-size: 45%;
        font-size: var(--am-type-meta-size);
        color: var(--am-ink-500);
        text-align: end;
      }
      .am-file-row__state--refused {
        color: var(--am-danger-ink);
      }
    `,
  ],
})
export class TaskAddEvidenceDialogComponent {
  private readonly fb = inject(FormBuilder);
  private readonly taskService = inject(TaskService);
  private readonly files = inject(FilesService);
  private readonly translate = inject(TranslateService);
  private readonly format = inject(FormatService);

  readonly visible = input.required<boolean>();
  readonly task = input<Pick<ITaskDto, 'id' | 'title' | 'requiresEvidence'> | null>(null);
  readonly visibleChange = output<boolean>();
  /** Emitted after at least one piece of evidence was added; the host reloads. */
  readonly added = output<void>();

  readonly kinds: readonly { value: EvidenceKind; labelKey: string }[] = [
    { value: 'LINK', labelKey: 'task.evidence.kindLink' },
    { value: 'FILE', labelKey: 'task.evidence.kindFile' },
  ];

  readonly kind = signal<EvidenceKind>('LINK');
  readonly queue = signal<QueuedFile[]>([]);
  readonly busy = signal(false);
  readonly error = signal<string | null>(null);
  readonly showErrors = signal(false);
  readonly dragOver = signal(false);
  readonly limits = signal<IUploadLimitsDto | null>(null);
  private nextId = 1;

  readonly linkForm = this.fb.group({
    url: ['', [Validators.required, httpUrl, Validators.maxLength(2000)]],
    linkTitle: ['', [Validators.maxLength(255)]],
  });

  readonly accept = computed(() => acceptAttribute(this.limits()?.allowedExtensions ?? []));

  readonly limitsLine = computed(() => {
    const limits = this.limits();
    return this.translate.instant('task.evidence.limits', {
      size: limits ? this.files.size(limits.maxUploadBytes) : '—',
      atATime: this.format.count('task.evidenceAtATime', MAX_FILES_AT_A_TIME),
    });
  });

  readonly contextLine = computed(() => {
    const task = this.task();
    if (!task) return '';
    return task.requiresEvidence
      ? this.translate.instant('task.evidence.contextRequired', { title: task.title })
      : task.title;
  });

  private readonly readyCount = computed(() => this.queue().filter((q) => q.state === 'ready').length);

  readonly primaryLabel = computed(() => {
    if (this.kind() === 'LINK') return this.translate.instant('task.addLink');
    const n = this.readyCount();
    return n > 1 ? this.format.count('task.evidenceAddFiles', n) : this.translate.instant('task.evidence.addFile');
  });

  readonly dirty = computed(() => this.queue().some((q) => q.state === 'ready') || this.linkFormDirty());
  private readonly linkFormDirty = signal(false);

  constructor() {
    this.linkForm.valueChanges.subscribe(() => this.linkFormDirty.set(this.linkForm.dirty));
    // Each opening starts clean. Untracked: nothing read here may re-run it.
    // The limits are read on the first opening, not when a page that merely
    // contains this dialog renders (FilesService keeps them for the session).
    effect(() => {
      if (!this.visible()) return;
      untracked(() => {
        this.reset();
        if (!this.limits()) {
          this.files.uploadLimits().subscribe({
            next: (limits) => this.limits.set(limits),
            error: () => this.limits.set(null),
          });
        }
      });
    });
  }

  chooseKind(kind: EvidenceKind): void {
    this.kind.set(kind);
    this.error.set(null);
  }

  onDragOver(event: DragEvent): void {
    event.preventDefault();
    this.dragOver.set(true);
  }

  onDrop(event: DragEvent): void {
    event.preventDefault();
    this.dragOver.set(false);
    this.enqueue(Array.from(event.dataTransfer?.files ?? []));
  }

  onPicked(input: HTMLInputElement): void {
    this.enqueue(Array.from(input.files ?? []));
    input.value = ''; // the same file may be chosen again after removing it
  }

  /** Adds chosen files, judging each against the installation's limits at once. */
  enqueue(chosen: File[]): void {
    this.error.set(null);
    const waiting = this.queue().filter((q) => q.state !== 'added');
    const room = MAX_FILES_AT_A_TIME - waiting.length;
    if (chosen.length > room) {
      this.error.set(this.format.count('task.evidenceTooMany', MAX_FILES_AT_A_TIME));
    }
    const accepted = chosen.slice(0, Math.max(0, room)).map((file) => this.judge(file));
    this.queue.set([...this.queue().filter((q) => q.state !== 'added'), ...accepted]);
  }

  unqueue(item: QueuedFile): void {
    this.queue.set(this.queue().filter((q) => q.id !== item.id));
  }

  stateLine(item: QueuedFile): string {
    switch (item.state) {
      case 'ready':
        return this.files.size(item.file.size);
      case 'uploading':
        return this.translate.instant('task.evidence.uploading', { percent: this.format.number(item.progress) });
      case 'added':
        return this.translate.instant('task.evidence.addedState');
      case 'refused':
        return item.reason ?? '';
    }
  }

  submit(): void {
    if (this.busy()) return;
    const task = this.task();
    if (!task) return;
    if (this.kind() === 'LINK') {
      this.submitLink(task.id);
    } else {
      void this.submitFiles(task.id);
    }
  }

  private submitLink(taskId: string): void {
    if (this.linkForm.invalid) {
      this.showErrors.set(true);
      return;
    }
    const { url, linkTitle } = this.linkForm.getRawValue();
    this.busy.set(true);
    this.error.set(null);
    this.taskService.addEvidence(taskId, { type: 'LINK', url: url!.trim(), linkTitle: linkTitle?.trim() || undefined }).subscribe({
      next: () => {
        this.busy.set(false);
        this.linkForm.markAsPristine();
        this.linkFormDirty.set(false);
        this.added.emit();
        this.visibleChange.emit(false);
      },
      error: (err: unknown) => {
        this.busy.set(false);
        this.error.set(this.translate.instant(extractErrorMessage(err, 'task.errorAction')));
      },
    });
  }

  private async submitFiles(taskId: string): Promise<void> {
    const ready = this.queue().filter((q) => q.state === 'ready');
    if (ready.length === 0) {
      this.error.set(this.translate.instant('files.refusal.FILE_MISSING'));
      return;
    }
    this.busy.set(true);
    this.error.set(null);
    let addedAny = false;
    for (const item of ready) {
      addedAny = (await this.upload(taskId, item)) || addedAny;
    }
    this.busy.set(false);
    if (addedAny) this.added.emit();
    // Everything went: close. Anything refused stays on screen with its reason.
    if (this.queue().every((q) => q.state === 'added')) {
      this.queue.set([]);
      this.visibleChange.emit(false);
    }
  }

  private upload(taskId: string, item: QueuedFile): Promise<boolean> {
    this.patch(item.id, { state: 'uploading', progress: 0 });
    return new Promise((resolve) => {
      this.taskService.addFileEvidence(taskId, item.file).subscribe({
        next: (event) => {
          if (event.type === HttpEventType.UploadProgress && event.total) {
            this.patch(item.id, { progress: Math.min(99, Math.round((event.loaded / event.total) * 100)) });
          }
          if (event.type === HttpEventType.Response) {
            this.patch(item.id, { state: 'added', progress: 100 });
            resolve(true);
          }
        },
        error: (err: unknown) => {
          const reason = this.files.refusal(err) ?? this.translate.instant(extractErrorMessage(err, 'task.errorAction'));
          this.patch(item.id, { state: 'refused', reason });
          resolve(false);
        },
      });
    });
  }

  // The screen's half of the server's rule: type by name and size, from the
  // installation's own limits. The server judges the content as well.
  private judge(file: File): QueuedFile {
    const base = { id: this.nextId++, file, progress: 0 };
    const limits = this.limits();
    if (file.size === 0) return { ...base, state: 'refused', reason: this.translate.instant('files.refusal.FILE_EMPTY') };
    if (limits && !limits.allowedExtensions.includes(extensionOf(file.name))) {
      return { ...base, state: 'refused', reason: this.translate.instant('files.refusal.FILE_TYPE_NOT_ALLOWED') };
    }
    if (limits && file.size > limits.maxUploadBytes) {
      return {
        ...base,
        state: 'refused',
        reason: this.translate.instant('files.refusal.FILE_TOO_LARGE', { size: this.files.size(limits.maxUploadBytes) }),
      };
    }
    return { ...base, state: 'ready', reason: null };
  }

  private patch(id: number, change: Partial<QueuedFile>): void {
    this.queue.set(this.queue().map((q) => (q.id === id ? { ...q, ...change } : q)));
  }

  private reset(): void {
    this.kind.set('LINK');
    this.queue.set([]);
    this.error.set(null);
    this.showErrors.set(false);
    this.dragOver.set(false);
    this.linkForm.reset({ url: '', linkTitle: '' });
    this.linkFormDirty.set(false);
  }
}
