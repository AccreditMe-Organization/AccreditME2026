// The New Task step strip, rendered in the DIALOG HEADER (ACC-96).
//
// Template 3 draws it there — inside the same header block as the title, the
// context line and the ✕, with the body starting after it. Two consequences,
// both of them the point:
//
//   - THE HEADER DOES NOT CHANGE between step 1's fields and its date view.
//     That is what tells a user they have not moved to another step, and it is
//     why the strip cannot live in the body, which the date view replaces.
//   - It costs NOTHING against the 420px body cap. In the body it cost 37px
//     with its gap, which is why the date view had to hide it — a deviation
//     this removes rather than works around.
//
// Same instance-passing shape as TaskFormFooterComponent, and for the same
// reason: p-dialog collects pTemplate children at content init, so the host's
// header template must exist from the start and the form instance travels
// outward to fill it.
//
// ACC-120 slice 6 — THE MARKUP AND CSS MOVED to shared StepStripComponent when
// a second stepped dialog needed them. This component stays because its job is
// the instance-passing above, which is specific to this form; what it no longer
// owns is the drawing of a step strip, so the two cannot drift into looking
// like different things.
import { Component, input } from '@angular/core';
import { TaskFormComponent } from './task-form.component';
import { StepStripComponent } from '../../../../shared/components/step-strip/step-strip.component';

@Component({
  selector: 'app-task-form-steps',
  standalone: true,
  imports: [StepStripComponent],
  template: `
    @if (form(); as f) {
      <am-step-strip [steps]="f.steps" [current]="f.step()" ariaLabel="Steps" />
    }
  `,
})
export class TaskFormStepsComponent {
  readonly form = input<TaskFormComponent | null>(null);
}
