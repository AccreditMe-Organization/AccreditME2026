import { inject } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';

// ACC-82 — the receiving half of a Setup health Fix link.
//
// A Fix names one object: `/org-positions?edit=<id>` should open THAT
// position's edit dialog, not leave the admin hunting through a list for it.
// The destination screen reads the parameter once, acts on it, and removes it
// from the URL (replaceUrl, so Back does not re-open the dialog either). Left in
// place, a reload or a later list refresh would open the same dialog again
// after the admin had finished with it.
//
// Call from an injection context (a field initialiser or the constructor) —
// the returned function may then be called later, e.g. once a list has loaded.
export function injectFixLinkParam(
  name: string,
): () => string | null {
  const route = inject(ActivatedRoute);
  const router = inject(Router);
  let consumed = false;

  return () => {
    if (consumed) return null;
    const value = route.snapshot.queryParamMap.get(name);
    if (!value) return null;
    consumed = true;
    void router.navigate([], {
      relativeTo: route,
      queryParams: { [name]: null },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
    return value;
  };
}
