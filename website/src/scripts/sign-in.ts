// ACC-213 — the Sign in box's behaviour. Bundled into an external file (never
// inline: the CSP is script-src 'self'). No network call: Continue is a
// navigation to the organisation's own address.
import { readAddress, signInUrl, type AddressProblem } from '../lib/organisation-address';

const STORAGE_KEY = 'accreditme.website.lastOrganisation';

function remember(slug: string): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, slug);
  } catch {
    // Private mode, blocked storage: remembering is a convenience only.
  }
}

function recall(): string | null {
  try {
    return window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

export function initSignIn(): void {
  for (const form of document.querySelectorAll<HTMLFormElement>('form[data-sign-in]')) {
    const input = form.querySelector<HTMLInputElement>('input[name="org"]');
    const error = form.querySelector<HTMLElement>('.sign-in__error');
    if (!input || !error) continue;

    const message = (problem: AddressProblem): string => {
      const key = `error${problem[0]!.toUpperCase()}${problem.slice(1)}` as const;
      return form.dataset[key] ?? '';
    };

    const last = recall();
    if (last && readAddress(last).ok && input.value === '') input.value = last;

    const clear = (): void => {
      error.textContent = '';
      input.removeAttribute('aria-invalid');
    };
    input.addEventListener('input', clear);

    form.addEventListener('submit', (event) => {
      event.preventDefault();
      const result = readAddress(input.value);
      if (!result.ok) {
        error.textContent = message(result.problem);
        input.setAttribute('aria-invalid', 'true');
        input.focus();
        return;
      }
      clear();
      remember(result.slug);
      window.location.assign(signInUrl(result.slug));
    });
  }
}
