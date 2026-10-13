import { Component, inject, output } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import { AiAssistComponent } from '../../../../shared/components/ai-assist/ai-assist.component';
import { TaskDraftStore } from './task-draft.store';

/**
 * ACC-197 — "✦ Draft with AI", on the Description field's label row.
 *
 * The trigger half of the one AI pattern (am-ai-assist with `hideResult`); the
 * suggestion is drawn under the field by app-task-draft-card. Absent — not
 * disabled — when AI is not available for the organisation, so the form is
 * exactly as it was.
 *
 * `labelRow` draws it at the height of the label's own line, so the row is
 * exactly as tall as it was (the drawing: "the trigger sits on the field's
 * label row, so it never adds height") and nothing overflows the dialog body,
 * whose top edge would clip it.
 */
@Component({
  selector: 'app-task-draft-trigger',
  standalone: true,
  imports: [AiAssistComponent, TranslatePipe],
  template: `
    @if (store.available()) {
      <div class="am-draft-trigger">
        <am-ai-assist
          placement="inline"
          [labelRow]="true"
          [hideResult]="true"
          [state]="store.state() === 'working' ? 'working' : 'idle'"
          [triggerLabel]="'task.draft.trigger' | translate"
          [againLabel]="'task.draft.again' | translate"
          [hasResult]="store.hasDrafted()"
          [cancellable]="true"
          (trigger)="requested.emit()"
          (cancel)="store.cancel()"
        />
      </div>
    }
  `,
  styles: [
    `
      :host {
        display: block;
      }
      .am-draft-trigger {
        display: flex;
        align-items: center;
      }
    `,
  ],
})
export class TaskDraftTriggerComponent {
  readonly store = inject(TaskDraftStore);
  /** The form gathers the note, the title and the record, and asks the store. */
  readonly requested = output<void>();
}
