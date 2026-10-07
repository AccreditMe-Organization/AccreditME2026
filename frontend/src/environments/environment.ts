export const environment = {
  production: false,
  // ACC-139 — relative, through the dev server's proxy (proxy.conf.js), so a
  // page on al-nakheel.localhost:4200 calls the API same-origin and its
  // SameSite=Strict session cookies are sent.
  apiUrl: '/api/v1',
  // The organisation is the one label in front of this (core/tenant/tenant-host.ts).
  baseDomain: 'localhost',
};
