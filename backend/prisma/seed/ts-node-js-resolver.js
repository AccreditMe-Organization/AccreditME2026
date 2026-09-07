// ACC-62 — lets ts-node resolve the `.js` specifiers this codebase's source
// uses, so the seed can import AppModule and get real NestJS services.
//
// The problem: prisma.service.ts imports '../../generated/prisma/client.js',
// but Prisma 7 generates client.TS. TypeScript resolves that fine (a `.js`
// specifier maps to its `.ts` source), and so does the built output (nest
// build emits a real client.js into dist/). Plain ts-node does not — Node's
// require looks for the literal file and fails.
//
// The test suite already solves exactly this, in package.json's jest config:
//     "moduleNameMapper": { "^(\\.{1,2}/.*)\\.js$": "$1" }
// This is that same mapping for ts-node, and nothing more.
//
// Why not the alternatives:
//   - Compiling the seed instead: tsconfig.build.json excludes `prisma`
//     entirely, so dist/prisma/seed/ is never emitted. Including it would
//     change the production build to serve a dev-only script.
//   - Hand-wiring the services instead of importing AppModule: dozens of
//     providers deep, and it would silently drift from the real module graph —
//     precisely the failure ACC-23 removed from demo-seed.ts.
//
// Deliberately conservative: it only ever runs AFTER normal resolution has
// already failed, and only for relative `.js` specifiers. A genuinely missing
// module still throws its original error.
const Module = require('module');

const originalResolveFilename = Module._resolveFilename;

Module._resolveFilename = function patchedResolve(request, ...rest) {
  try {
    return originalResolveFilename.call(this, request, ...rest);
  } catch (error) {
    const isRelative = request.startsWith('./') || request.startsWith('../');
    if (isRelative && request.endsWith('.js')) {
      return originalResolveFilename.call(this, request.slice(0, -'.js'.length), ...rest);
    }
    throw error;
  }
};
