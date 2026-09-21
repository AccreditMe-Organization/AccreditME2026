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
import { Component, input } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
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
            <p-button
              [label]="'task.nextDetails' | translate"
              severity="secondary"
              [outlined]="true"
              type="button"
              (onClick)="f.goToStep(2)"
              [disabled]="f.saving()"
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
  readonly form = input<TaskFormComponent | null>(null);
}
