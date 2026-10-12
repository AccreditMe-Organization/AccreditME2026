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
//
// ACC-204 — THE ORIGIN SHIM. The backend holds a cookie session to its
// organisation's address, read from the request's Origin
// (backend/src/common/tenant/session-address.ts). In production every call the
// app makes is cross-origin (the app is on {slug}.accreditme.app, the API on
// api.accreditme.app), so a browser always sends Origin. Through this proxy the
// calls are SAME-origin, and a browser sends no Origin on a same-origin GET or
// HEAD — so without this every local GET would be refused. When the browser
// sent none, the proxy adds the one a cross-origin call would have carried: the
// page's own origin, from the Host the browser asked for. Dev only; the backend
// rule is the same everywhere.
module.exports = {
  '/api': {
    target: process.env.API_PROXY_TARGET ?? 'http://localhost:3000',
    secure: false,
    changeOrigin: false,
    configure: (proxy) => {
      proxy.on('proxyReq', (proxyReq, req) => {
        if (!req.headers.origin && req.headers.host) {
          proxyReq.setHeader('origin', `http://${req.headers.host}`);
        }
      });
    },
  },
};
