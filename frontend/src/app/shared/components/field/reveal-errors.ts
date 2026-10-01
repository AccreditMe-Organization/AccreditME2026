import { ElementRef } from '@angular/core';
import { FormGroup } from '@angular/forms';

/**
 * Reveal a form's errors and put focus on the first invalid control.
 *
 * ## When to call this, and when not to
 *
 * NOT ON SUBMIT. `am-field` reads the enclosing form's own `submitted` state, so
 * a form that submits reveals its errors with nothing called at all — which is
 * the point of that change and the reason `forceShowErrors` is no longer
 * something a form has to remember.
 *
 * This exists for the ONE case `submitted` cannot describe: an advance that is
 * not a submit. A stepped dialog's Next is the only instance today. The caller
 * still has to bind `[forceShowErrors]` on those fields, because there is no
 * form event to read.
 *
 * ## Why focus is resolved by CONTROL order, not DOM order
 *
 * `Object.keys(form.controls)` is the order the form was declared in, which is
 * stable against template rearrangement. A DOM query ordered by position would
 * change its answer the day someone moves a field, silently, and focus landing
 * somewhere unexpected is hard to attribute to a template edit weeks later.
 *
 * ## It focuses only what is RENDERED
 *
 * On a stepped form the invalid control may be on a step the reader cannot see.
 * `querySelector` simply finds nothing there and focus stays put, which is
 * correct: the caller is responsible for showing the right step first, because
 * only the caller knows which step a control is on.
 */
export function revealAndFocusFirstInvalid(form: FormGroup, host: ElementRef<HTMLElement>): void {
  form.markAllAsTouched();

  const firstInvalid = Object.keys(form.controls).find((name) => form.get(name)?.invalid);
  if (!firstInvalid) return;

  host.nativeElement
    .querySelector<HTMLElement>(`#${firstInvalid}, [formcontrolname="${firstInvalid}"]`)
    ?.focus();
}
