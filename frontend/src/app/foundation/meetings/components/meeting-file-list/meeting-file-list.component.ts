import { Component, ElementRef, computed, inject, input, output, signal, viewChild } from '@angular/core';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { ButtonModule } from 'primeng/button';
import { FilesService, acceptAttribute } from '../../../../shared/files/files.service';
import { FileViewerService } from '../../../../shared/files/viewer/file-viewer.service';
import { IconButtonComponent } from '../../../../shared/components/icon-button/icon-button.component';
import { AmConfirmService } from '../../../../shared/components/confirm/am-confirm.service';
import { MeetingService, type MeetingFileDto } from '../../services/meeting.service';
import { meetingRefusalKey } from '../../meeting-refusal';

/**
 * ACC-316 PR 7 — a meeting's files in flow: an agenda item's papers
 * (`itemId` set) or the meeting's general attachments (`itemId` null). Each
 * file opens in the in-app viewer (the meeting's view mint, the same
 * entitlement as its download); whoever may manage the agenda adds and removes
 * them. One upload at a time, said while it runs; a refusal is said from its
 * code (storage's own, or the meeting's), never the server's words.
 */
@Component({
  selector: 'am-meeting-file-list',
  standalone: true,
  imports: [TranslatePipe, ButtonModule, IconButtonComponent],
  template: `
    <div class="flex flex-col gap-1" [attr.data-testid]="testId()">
      @if (files().length > 0) {
        <ul class="m-0 flex flex-wrap gap-1.5 ps-0 list-none">
          @for (f of files(); track f.id) {
            <li class="flex items-center gap-0.5 rounded border border-[var(--am-border)] ps-2 text-[12px]" [attr.data-file]="f.id">
              <button type="button" class="am-meeting-file__open truncate" [attr.title]="f.name" (click)="open(f)">
                <i class="pi pi-file me-1" aria-hidden="true"></i><span dir="auto">{{ f.name }}</span>
              </button>
              @if (canManage()) {
                <am-icon-button icon="pi pi-times" [label]="'meeting.files.remove' | translate: { name: f.name }" [disabled]="busy()" (activated)="askRemove(f)" />
              }
            </li>
          }
        </ul>
      }
      @if (canManage()) {
        <div class="flex items-center gap-2">
          <input #fileInput type="file" class="hidden" [accept]="accept()" (change)="onChosen($event)" [attr.data-testid]="testId() + '-input'" />
          <p-button size="small" [text]="true" icon="pi pi-paperclip" [label]="addLabel() | translate" [loading]="uploading() !== null" [disabled]="busy()" (onClick)="fileInput.click()" [attr.data-testid]="testId() + '-add'" />
          @if (uploading(); as name) {
            <span class="text-meta text-[var(--am-ink-500)] truncate" aria-live="polite">{{ 'meeting.files.uploading' | translate: { name: name } }}</span>
          }
        </div>
      }
      @if (error()) {
        <p class="m-0 text-meta text-[var(--am-danger-ink)]" role="alert">{{ error() }}</p>
      }
    </div>
  `,
  styles: [
    `
      .am-meeting-file__open {
        max-inline-size: 16rem;
        padding: 0;
        border: none;
        background: none;
        color: var(--am-blue-primary);
        cursor: pointer;
        font: inherit;
      }
      .am-meeting-file__open:hover {
        text-decoration: underline;
      }
      .am-meeting-file__open:focus-visible {
        outline: var(--am-focus-ring-width) solid var(--am-focus-ring);
        outline-offset: 1px;
      }
    `,
  ],
})
export class MeetingFileListComponent {
  private readonly meetings = inject(MeetingService);
  private readonly filesService = inject(FilesService);
  private readonly viewer = inject(FileViewerService);
  private readonly confirm = inject(AmConfirmService);
  private readonly translate = inject(TranslateService);

  readonly meetingId = input.required<string>();
  /** The agenda item whose papers these are, or null for the meeting's attachments. */
  readonly itemId = input<string | null>(null);
  readonly files = input<MeetingFileDto[]>([]);
  readonly canManage = input(false);
  readonly addLabel = input('meeting.files.addPaper');
  /** The viewer's "From …" line. */
  readonly contextLabel = input('');
  readonly testId = input('meeting-files');
  /** A file was added or removed: the host reads the files again. */
  readonly changed = output<void>();

  readonly uploading = signal<string | null>(null);
  readonly removing = signal<string | null>(null);
  readonly error = signal<string | null>(null);
  readonly busy = computed(() => this.uploading() !== null || this.removing() !== null);
  readonly allowed = signal<string[]>([]);
  readonly accept = computed(() => acceptAttribute(this.allowed()));
  private readonly fileInput = viewChild<ElementRef<HTMLInputElement>>('fileInput');

  constructor() {
    this.filesService.uploadLimits().subscribe({ next: (l) => this.allowed.set(l.allowedExtensions), error: () => this.allowed.set([]) });
  }

  onChosen(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file || this.busy()) return;
    this.uploading.set(file.name);
    this.error.set(null);
    const id = this.meetingId();
    const itemId = this.itemId();
    const request = itemId ? this.meetings.addPaper(id, itemId, file) : this.meetings.addAttachment(id, file);
    request.subscribe({
      next: () => {
        this.uploading.set(null);
        this.changed.emit();
      },
      error: (err: unknown) => {
        this.uploading.set(null);
        this.error.set(this.say(err, 'meeting.files.uploadError'));
      },
    });
  }

  open(file: MeetingFileDto): void {
    const files = this.files();
    const id = this.meetingId();
    this.viewer.open({
      files,
      startIndex: Math.max(0, files.findIndex((f) => f.id === file.id)),
      context: { key: 'meeting.files.viewerContext', params: { name: this.contextLabel() } },
      access: (f) => this.meetings.viewFile(id, f.id),
      download: (f) =>
        this.meetings.downloadFile(id, f.id).subscribe({
          next: (d) => this.filesService.open(d),
          error: (err: unknown) => this.error.set(this.say(err, 'meeting.files.openError')),
        }),
    });
  }

  askRemove(file: MeetingFileDto): void {
    this.confirm.ask({
      tone: 'destructive',
      header: this.translate.instant('meeting.files.removeTitle'),
      message: this.translate.instant('meeting.files.removeLead', { name: file.name }),
      acceptLabel: this.translate.instant('meeting.files.removeConfirm'),
      accept: () => {
        this.removing.set(file.id);
        this.error.set(null);
        this.meetings.removeFile(this.meetingId(), file.id).subscribe({
          next: () => {
            this.removing.set(null);
            this.changed.emit();
          },
          error: (err: unknown) => {
            this.removing.set(null);
            this.error.set(this.say(err, 'meeting.files.removeError'));
          },
        });
      },
    });
  }

  /** Storage's refusal in words, else the meeting's, else this list's own sentence. */
  private say(err: unknown, fallback: string): string {
    const storage = this.filesService.refusal(err);
    if (storage) return storage;
    return this.translate.instant(meetingRefusalKey(err) ?? fallback);
  }
}
