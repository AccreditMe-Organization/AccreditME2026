export const environment = {
  production: true,
  // ACC-130 — the API is served at api.accreditme.app, a direct CNAME to
  // Railway (no proxy). Absolute, because the app itself is on Vercel. It is
  // the same SITE as every {slug}.accreditme.app, which is what lets the
  // SameSite=Strict session cookies travel with these calls. vercel.json's
  // CSP connect-src names this origin; check:vercel-config keeps them equal.
  apiUrl: 'https://api.accreditme.app/api/v1',
  // Every organisation signs in at {slug}.accreditme.app (ACC-139).
  baseDomain: 'accreditme.app',
};
