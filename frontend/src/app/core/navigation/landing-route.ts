// ACC-70 — the one place the post-login / fallback destination is named.
//
// Before this it was the string '/organization', repeated in three places:
// LoginComponent.redirectAfterLogin(), platformAdminGuard's fallback, and
// app.routes.ts's bare-root redirect. That was the direct cause of ACC-62's
// persona finding — a user with no permissions was sent to an admin screen
// they could not use, which then rendered a wall of failed requests.
//
// Named rather than inlined so the three sites cannot drift apart again, and
// so a future change of landing destination is one edit.
export const LANDING_ROUTE = '/home';
