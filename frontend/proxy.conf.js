// ACC-139 — the dev server forwards /api to the backend, so every page,
// whichever {slug}.localhost it is on, calls the API on its own origin.
//
// WHY: the session cookies are SameSite=Strict, and al-nakheel.localhost and
// localhost are different sites, so a page on a tenant's subdomain calling
// http://localhost:3000 directly would never send them. Through this proxy
// every call is same-origin and the cookies are host-only per subdomain.
//
// A second checkout running its own backend sets API_PROXY_TARGET, e.g.
//   $env:API_PROXY_TARGET='http://localhost:3001'; npx ng serve --port 4201
module.exports = {
  '/api': {
    target: process.env.API_PROXY_TARGET ?? 'http://localhost:3000',
    secure: false,
    changeOrigin: false,
  },
};
