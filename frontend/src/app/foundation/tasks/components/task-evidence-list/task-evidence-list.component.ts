import { Component, ElementRef, computed, effect, inject, input, output, signal, untracked } from '@angular/core';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { ConfirmationService } from 'primeng/api';
import { IconButtonComponent } from '../../../../shared/components/icon-button/icon-button.component';
import { extractErrorMessage } from '../../../../shared/utils/http-error.util';
import { FilesService } from '../../../../shared/files/files.service';
import { FileViewerService } from '../../../../shared/files/viewer/file-viewer.service';
import { IViewableFile } from '../../../../shared/files/viewer/file-viewer.model';
import { FormatService } from '../../../../core/formatting';
import { ITaskEvidenceDto, ITaskEvidenceListDto, TaskService } from '../../services/task.service';

/**
 * A task's evidence — ACC-177, the drawing's Evidence panel (Task Screens §1,
 * the task page's second column).
 *
 * BUILT TO BE HOSTED UNCHANGED by the task's own page (ACC-120 slice 3) as well
 * as by the evidence dialog on My tasks and a record's task list. It loads its
 * own data from GET /tasks/:id/evidence, which answers who may see it, and
 * whether the viewer may add or remove; the panel never decides that itself.
 *
 * Rows: a glyph for the kind, the title (a file's name, a link's title or
 * address, a record's name), and who added it and when. A file OPENS IN THE
 * VIEWER from its name or its eye button (ACC-189), and downloads; a link
 * opens in a new tab; the person who added a piece removes it while the
 * task is open. Evidence on a completed or cancelled task is read-only, and
 * the panel says so rather than leaving the reader to wonder why nothing can
 * be done.
 */
@Component({
  selector: 'app-task-evidence-list',
  standalone: true,
  imports: [TranslatePipe, IconButtonComponent],
  template: `
    <section class="am-evidence" [attr.aria-labelledby]="headingId">
      <header class="am-evidence__head">
        <span class="flex items-center gap-2">
          <h3 class="am-evidence__title" [id]="headingId">{{ 'task.evidence.title' | translate }}</h3>
          @if (items().length) {
            <span class="am-evidence__count">{{ count() }}</span>
          }
          @if (requiresEvidence()) {
            <span class="text-meta text-[var(--am-ink-500)]">{{ 'task.evidence.requiredTag' | translate }}</span>
          }
        </span>
        @if (showAdd() && canAdd()) {
          <button type="button" class="am-evidence__add" (click)="addRequested.emit()">
            {{ 'task.evidence.add' | translate }}
          </button>
        }
      </header>

      @if (loading() && !loaded()) {
        <p class="am-evidence__note" aria-live="polite">{{ 'common.loading' | translate }}</p>
      } @else if (loadError()) {
        <p class="am-evidence__note text-[var(--am-danger-ink)]" role="alert">{{ loadError() }}</p>
      } @else if (!items().length) {
        <p class="am-evidence__note" [class.am-evidence__note--warn]="requiresEvidence()">
          {{ (requiresEvidence() ? 'task.evidence.noneRequired' : 'task.evidence.none') | translate }}
        </p>
      } @else {
        <ul class="am-evidence__rows">
          @for (item of items(); track item.id) {
            <li class="am-evidence__row">
              <i [class]="glyph(item)" class="am-evidence__glyph" aria-hidden="true"></i>
              <span class="am-evidence__main">
                @if (item.type === 'LINK' && item.url) {
                  <a class="am-evidence__name am-evidence__name--link" [href]="item.url" target="_blank" rel="noopener noreferrer" dir="auto">{{ title(item) }}</a>
                } @else if (item.file) {
                  <button
                    type="button"
                    class="am-evidence__name am-evidence__name--link am-evidence__name--button"
                    dir="auto"
                    [attr.data-am-evidence-file]="item.id"
                    [attr.title]="title(item)"
                    (click)="view(item)"
                  >{{ title(item) }}</button>
                } @else {
                  <span class="am-evidence__name" dir="auto" [attr.title]="title(item)">{{ title(item) }}</span>
                }
                <span class="am-evidence__meta">{{ meta(item) }}</span>
              </span>
              @if (item.file) {
                <am-icon-button
                  icon="pi pi-eye"
                  [label]="'task.evidence.viewFileNamed' | translate: { name: item.file.name }"
                  (activated)="view(item)"
                />
                <am-icon-button
                  icon="pi pi-download"
                  [label]="'task.evidence.downloadNamed' | translate: { name: item.file.name }"
                  [disabled]="busyId() === item.id"
                  (activated)="download(item)"
                />
              }
              @if (item.canDelete) {
                <am-icon-button
                  icon="pi pi-trash"
                  severity="danger"
                  [label]="'task.evidence.removeNamed' | translate: { name: title(item) }"
                  [disabled]="busyId() === item.id"
                  (activated)="confirmRemove(item)"
                />
              }
            </li>
          }
        </ul>
        @if (readOnly()) {
          <p class="am-evidence__note">{{ 'task.evidence.readOnly' | translate }}</p>
        }
      }
      @if (actionError()) {
        <p class="am-evidence__note text-[var(--am-danger-ink)]" role="alert">{{ actionError() }}</p>
      }
    </section>
  `,
  styles: [
    `
      .am-evidence {
        background: var(--am-surface-raised);
        border: 1px solid var(--am-border);
        border-radius: var(--am-radius-card);
      }
      .am-evidence__head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: var(--am-space-8);
        padding: var(--am-space-8) var(--am-space-12);
        border-block-end: 1px solid var(--am-border);
      }
      .am-evidence__title {
        margin: 0;
        font-size: var(--am-type-micro-size);
        font-weight: 700;
        letter-spacing: var(--am-type-micro-tracking);
        text-transform: var(--am-type-micro-transform);
        color: var(--am-ink-500);
      }
      .am-evidence__count {
        font-size: var(--am-type-micro-size);
        font-weight: 600;
        color: var(--am-neutral-chip-ink);
        background: var(--am-neutral-chip-bg);
        border: 1px solid var(--am-neutral-chip-border);
        border-radius: var(--am-radius-control);
        padding: 0 var(--am-space-6);
      }
      .am-evidence__add {
        border: none;
        background: none;
        padding: 0;
        font-size: var(--am-type-meta-size);
        font-weight: 600;
        color: var(--am-primary-600);
        cursor: pointer;
      }
      .am-evidence__add:hover {
        color: var(--am-primary-700);
        text-decoration: underline;
      }
      .am-evidence__add:focus-visible {
        outline: var(--am-focus-ring-width) solid var(--am-focus-ring);
        outline-offset: var(--am-focus-ring-offset);
      }
      .am-evidence__rows {
        list-style: none;
        margin: 0;
        padding: 0;
      }
      .am-evidence__row {
        display: flex;
        align-items: center;
        gap: var(--am-space-8);
        padding: var(--am-space-6) var(--am-space-12);
        border-block-end: 1px solid var(--am-row-rule);
      }
      .am-evidence__glyph {
        flex: none;
        display: flex;
        align-items: center;
        justify-content: center;
        inline-size: 26px;
        block-size: 26px;
        border: 1px solid var(--am-border);
        border-radius: var(--am-radius-button);
        background: var(--am-surface);
        color: var(--am-ink-700);
        font-size: var(--am-type-meta-size);
      }
      .am-evidence__main {
        flex: 1 1 auto;
        min-inline-size: 0;
        display: flex;
        flex-direction: column;
      }
      .am-evidence__name {
        font-size: var(--am-type-value-size);
        font-weight: 500;
        color: var(--am-ink-900);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .am-evidence__name--link {
        color: var(--am-primary-600);
        text-decoration: none;
      }
      .am-evidence__name--link:hover {
        text-decoration: underline;
      }
      .am-evidence__name--button {
        display: block;
        max-inline-size: 100%;
        padding: 0;
        border: none;
        background: none;
        font: inherit;
        font-size: var(--am-type-value-size);
        font-weight: 500;
        text-align: start;
        unicode-bidi: plaintext;
        cursor: pointer;
      }
      .am-evidence__name--button:focus-visible {
        outline: var(--am-focus-ring-width) solid var(--am-focus-ring);
        outline-offset: var(--am-focus-ring-offset);
      }
      .am-evidence__meta {
        font-size: var(--am-type-meta-size);
        color: var(--am-ink-500);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .am-evidence__note {
        margin: 0;
        padding: var(--am-space-8) var(--am-space-12);
        font-size: var(--am-type-meta-size);
        color: var(--am-ink-500);
      }
      .am-evidence__note--warn {
        color: var(--am-warning-ink);
        font-weight: 600;
      }
    `,
  ],
})
export class TaskEvidenceListComponent {
  private readonly taskService = inject(TaskService);
  private readonly files = inject(FilesService);
  private readonly format = inject(FormatService);
  private readonly translate = inject(TranslateService);
  private readonly confirmation = inject(ConfirmationService);
  private readonly viewer = inject(FileViewerService);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  readonly taskId = input.required<string>();
  readonly requiresEvidence = input(false);
  /** Whether the panel offers its own "Add evidence" link (a host with its own button sets false). */
  readonly showAdd = input(true);
  readonly addRequested = output<void>();
  /** Evidence was removed; a host showing a count reloads it. */
  readonly changed = output<void>();
  /** The server's answer for this viewer, once loaded. */
  readonly canAddChange = output<boolean>();

  private static nextId = 0;
  readonly headingId = `am-evidence-${TaskEvidenceListComponent.nextId++}`;

  readonly loading = signal(false);
  readonly loaded = signal(false);
  readonly loadError = signal<string | null>(null);
  readonly actionError = signal<string | null>(null);
  readonly busyId = signal<string | null>(null);
  private readonly data = signal<ITaskEvidenceListDto | null>(null);

  readonly items = computed(() => this.data()?.items ?? []);
  readonly canAdd = computed(() => this.data()?.canAdd ?? false);
  readonly count = computed(() => this.format.number(this.items().length));
  // A closed task's evidence is the record of what proved the work (the
  // server's word): said once, so nobody wonders why nothing can be done.
  readonly readOnly = computed(() => this.data()?.closed ?? false);

  constructor() {
    effect(() => {
      const id = this.taskId();
      untracked(() => this.load(id));
    });
  }

  reload(): void {
    this.load(this.taskId());
  }

  glyph(item: ITaskEvidenceDto): string {
    switch (item.type) {
      case 'ATTACHMENT':
        return 'pi pi-file';
      case 'LINK':
        return 'pi pi-link';
      case 'INTERNAL_REFERENCE':
        return 'pi pi-database';
      default:
        return 'pi pi-align-left';
    }
  }

  title(item: ITaskEvidenceDto): string {
    if (item.file) return item.file.name;
    if (item.type === 'LINK') return item.linkTitle || item.url || '';
    if (item.type === 'INTERNAL_REFERENCE') return item.refDisplay || item.refId || '';
    return this.translate.instant('task.evidence.note');
  }

  meta(item: ITaskEvidenceDto): string {
    const parts = [item.uploadedBy.name, this.format.dateTime(item.uploadedAt)];
    if (item.file) parts.push(this.files.size(item.file.sizeBytes));
    else if (item.type === 'LINK' && item.linkTitle && item.url) parts.push(hostOf(item.url));
    return parts.join(' · ');
  }

  /**
   * ACC-189 — opens the viewer at this file, over the list's FILES only:
   * links and record references are not files, so "n / total" counts files
   * and stepping skips them. On close, focus returns to the name of the file
   * LAST SHOWN — which may be a different row if the reader stepped through.
   */
  view(item: ITaskEvidenceDto): void {
    const fileItems = this.items().filter((i) => i.file);
    const files: IViewableFile[] = fileItems.map((i) => ({
      id: i.id,
      name: i.file!.name,
      mimeType: i.file!.mimeType,
      sizeBytes: i.file!.sizeBytes,
    }));
    const taskId = this.taskId();
    this.viewer.open({
      files,
      startIndex: Math.max(0, fileItems.indexOf(item)),
      context: { key: 'files.viewer.from.taskEvidence' },
      access: (file) => this.taskService.viewEvidence(taskId, file.id),
      download: (file) => {
        const target = this.items().find((i) => i.id === file.id);
        if (target) this.download(target);
      },
      closed: (last) => this.focusFile(last.id),
    });
  }

  private focusFile(evidenceId: string): void {
    const name = this.host.nativeElement.querySelector(`[data-am-evidence-file="${CSS.escape(evidenceId)}"]`) as HTMLElement | null;
    name?.focus();
  }

  download(item: ITaskEvidenceDto): void {
    this.actionError.set(null);
    this.busyId.set(item.id);
    this.taskService.downloadEvidence(this.taskId(), item.id).subscribe({
      next: (download) => {
        this.busyId.set(null);
        this.files.open(download);
      },
      error: (err: unknown) => {
        this.busyId.set(null);
        this.actionError.set(this.files.refusal(err) ?? this.translate.instant(extractErrorMessage(err, 'task.errorAction')));
      },
    });
  }

  confirmRemove(item: ITaskEvidenceDto): void {
    this.confirmation.confirm({
      header: this.translate.instant('task.evidence.removeTitle'),
      // A file goes to the recycle bin for 30 days; a link or a reference is gone.
      message: this.translate.instant(item.file ? 'task.evidence.removeMessageFile' : 'task.evidence.removeMessage', {
        name: this.title(item),
      }),
      acceptLabel: this.translate.instant('task.evidence.removeConfirm'),
      rejectLabel: this.translate.instant('task.evidence.keep'),
      icon: 'pi pi-exclamation-triangle',
      acceptButtonProps: { severity: 'danger' },
      accept: () => this.remove(item),
    });
  }

  private remove(item: ITaskEvidenceDto): void {
    this.actionError.set(null);
    this.busyId.set(item.id);
    this.taskService.removeEvidence(this.taskId(), item.id).subscribe({
      next: () => {
        this.busyId.set(null);
        this.changed.emit();
        this.reload();
      },
      error: (err: unknown) => {
        this.busyId.set(null);
        this.actionError.set(this.translate.instant(extractErrorMessage(err, 'task.errorAction')));
      },
    });
  }

  private load(taskId: string): void {
    this.loading.set(true);
    this.loadError.set(null);
    this.taskService.listEvidence(taskId).subscribe({
      next: (list) => {
        this.data.set(list);
        this.loading.set(false);
        this.loaded.set(true);
        this.canAddChange.emit(list.canAdd);
      },
      error: (err: unknown) => {
        this.loading.set(false);
        this.loadError.set(this.translate.instant(extractErrorMessage(err, 'task.evidence.loadError')));
      },
    });
  }
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}
