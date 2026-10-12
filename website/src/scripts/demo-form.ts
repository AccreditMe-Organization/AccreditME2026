// ACC-213 — the demo form's validation, field by field as each one is left.
// No network call: the form has no action and its submit is disabled.

type Problem = 'required' | 'email' | 'tooLong';

function problemOf(field: HTMLInputElement | HTMLTextAreaElement): Problem | null {
  const v = field.validity;
  // A required field holding only spaces is still empty.
  if (v.valueMissing || (field.required && field.value.trim() === '')) return 'required';
  if (v.typeMismatch) return 'email';
  if (v.tooLong) return 'tooLong';
  return null;
}

export function initDemoForm(): void {
  for (const form of document.querySelectorAll<HTMLFormElement>('form[data-demo-form]')) {
    const message = (problem: Problem): string => {
      const key = ({ required: 'errorRequired', email: 'errorEmail', tooLong: 'errorTooLong' } as const)[problem];
      return form.dataset[key] ?? '';
    };

    const show = (field: HTMLInputElement | HTMLTextAreaElement): void => {
      const error = document.getElementById(`${field.id}-error`);
      if (!error) return;
      const problem = problemOf(field);
      error.textContent = problem ? message(problem) : '';
      if (problem) field.setAttribute('aria-invalid', 'true');
      else field.removeAttribute('aria-invalid');
    };

    for (const field of form.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('input, textarea')) {
      field.addEventListener('blur', () => show(field));
      field.addEventListener('input', () => {
        if (field.getAttribute('aria-invalid') === 'true') show(field);
      });
    }

    // Belt and braces: the submit button is disabled, but Enter in a field
    // must not send the form anywhere either.
    form.addEventListener('submit', (event) => event.preventDefault());
  }
}
