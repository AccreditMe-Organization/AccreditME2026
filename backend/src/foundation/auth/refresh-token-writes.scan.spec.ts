import { readdirSync, readFileSync } from 'fs';
import { join, relative } from 'path';

// ACC-126 — no RefreshToken row may be written without its session's start.
//
// The behaviour is pinned in session-time-limit.spec.ts (sign-in, MFA and
// refresh each write a start). This pins the STRUCTURE that makes it true for
// paths not yet written: there is exactly ONE place that creates a row —
// AuthService.issueRefreshToken() — its `sessionStartedAt` parameter is a
// required Date, and its create writes it. A second create site, a raw INSERT,
// an optional start, or a create that drops the field fails here by name.
//
// Impersonation creates no row (it replaces the access cookie only), so it is
// covered by its own spec (platform-tenant.service.spec.ts): the token it mints
// carries the platform admin's start.

const BACKEND = join(__dirname, '..', '..', '..');
const AUTH_SERVICE = join(BACKEND, 'src', 'foundation', 'auth', 'auth.service.ts');

function sources(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'generated') continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) sources(path, out);
    else if (
      path.endsWith('.ts') &&
      !path.endsWith('.spec.ts') &&
      !path.endsWith('.db-spec.ts')
    ) {
      out.push(path);
    }
  }
  return out;
}

const CREATE = /refreshToken\s*\.\s*(create|createMany|createManyAndReturn|upsert)\s*\(/g;
const RAW_INSERT = /INSERT\s+INTO\s+"?RefreshToken"?/gi;

describe('RefreshToken writes carry the session start (ACC-126)', () => {
  const files = [
    ...sources(join(BACKEND, 'src')),
    ...sources(join(BACKEND, 'prisma')),
  ];

  it('scans real files (non-vacuity)', () => {
    expect(files.length).toBeGreaterThan(100);
    expect(files).toContain(AUTH_SERVICE);
  });

  it('creates rows in exactly one place: AuthService.issueRefreshToken()', () => {
    const hits: string[] = [];
    for (const file of files) {
      const text = readFileSync(file, 'utf8');
      for (const m of text.matchAll(CREATE)) {
        hits.push(`${relative(BACKEND, file)}: ${m[0]}`);
      }
      for (const m of text.matchAll(RAW_INSERT)) {
        hits.push(`${relative(BACKEND, file)}: ${m[0]}`);
      }
    }
    expect(hits).toEqual([
      `${relative(BACKEND, AUTH_SERVICE)}: refreshToken.create(`,
    ]);
  });

  it('issueRefreshToken() requires the start, and its create writes it', () => {
    const text = readFileSync(AUTH_SERVICE, 'utf8');
    const start = text.indexOf('private async issueRefreshToken(');
    const end = text.indexOf('return { token: rawToken, expiresAt };', start);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const body = text.slice(start, end);

    // A required Date — not optional, not nullable.
    expect(body).toMatch(/\n\s+sessionStartedAt: Date,\n/);
    // Written on the row, by name, inside the create's data.
    const data = body.slice(body.indexOf('data: {'));
    expect(data).toMatch(/\n\s+sessionStartedAt,\n/);
  });
});
