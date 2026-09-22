// The New Task footer, rendered in the DIALOG's fixed footer rather than in
// its scrolling body (ACC-96).
//
// A separate component rather than markup duplicated into the two hosts, and
// rather than a TemplateRef handed outward. The TemplateRef route was tried
// first and does not work: p-dialog collects its pTemplate children at CONTENT
// INIT, so a footer arriving from a projected component's ngAfterViewInit is
// already too late and silently renders nothing. The host's footer template
// therefore has to exist from the start — so the FORM INSTANCE travels
// outward, and this renders against it.
//
// The buttons call onSubmit() directly rather than being type="submit" with a
// form= attribute. The native attribute route was tried and silently does
// nothing: p-button has no `form` input, so the attribute lands on the
// <p-button> host and never reaches the <button> PrimeNG renders inside it.
// Create looked enabled and did nothing at all — caught in a browser.
//
// Why it matters that this is not in the body: the footer costs 63px, and the
// date view leaves 6px against the 420px cap. In the body it pushed the
// calendar into a scrolling ancestor, which is the defect this ticket removes.
import { Component, inject, input } from '@angular/core';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { ButtonModule } from 'primeng/button';
import { TaskFormComponent } from './task-form.component';

@Component({
  selector: 'app-task-form-footer',
  standalone: true,
  imports: [TranslatePipe, ButtonModule],
  template: `
    @if (form(); as f) {
      <div class="am-task-form__footer">
          @if (f.step() === 1) {
            <p-button
              [label]="'common.cancel' | translate"
              severity="secondary"
              [text]="true"
              type="button"
              (onClick)="f.cancelled.emit()"
              [disabled]="f.saving()"
            />
            <!-- VISIBLE BUT DISABLED while the date view is open (Ahmad's
                 decision, a small deviation from the drawing): Cancel and
                 Create stay active, and Next comes back the moment the
                 calendar closes. Removing it instead would move Create under
                 the cursor.

                 The reason reaches BOTH audiences: a title attribute for a
                 pointer, and the accessible NAME carries it too, since a
                 disabled button is out of the tab order but is still read in a
                 screen reader's browse mode. -->
            <p-button
              [label]="'task.nextDetails' | translate"
              severity="secondary"
              [outlined]="true"
              type="button"
              (onClick)="f.goToStep(2)"
              [disabled]="f.saving() || f.dateView()"
              [ariaLabel]="nextLabel(f)"
              [title]="f.dateView() ? ('task.due.closeCalendarFirst' | translate) : ''"
            />
            <p-button
              [label]="'task.create' | translate"
              type="button"
              (onClick)="f.onSubmit()"
              [loading]="f.saving()"
              [disabled]="!f.canCreateFromStep1()"
            />
          } @else {
            <p-button
              [label]="'common.back' | translate"
              severity="secondary"
              [text]="true"
              type="button"
              (onClick)="f.goToStep(1)"
              [disabled]="f.saving()"
            />
            <p-button
              [label]="'task.create' | translate"
              type="button"
              (onClick)="f.onSubmit()"
              [loading]="f.saving()"
              [disabled]="f.form.invalid"
            />
          }
        </div>
    }
  `,
  styles: [
    `
      .am-task-form__footer {
        display: flex;
        justify-content: flex-end;
        gap: 0.5rem;
      }
    `,
  ],
})
export class TaskFormFooterComponent {
  private readonly translate = inject(TranslateService);

  readonly form = input<TaskFormComponent | null>(null);

  /** "Next · Details — Close the calendar to continue" while it is disabled. */
  nextLabel(form: TaskFormComponent): string {
    const base = this.translate.instant('task.nextDetails');
    if (!form.dateView()) return base;
    return `${base} — ${this.translate.instant('task.due.closeCalendarFirst')}`;
  }
}
