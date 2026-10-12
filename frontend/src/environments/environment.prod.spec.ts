import { environment } from './environment.prod';

// ACC-130 — the production build's API address. The specs otherwise run
// against environment.ts, so nothing else would notice this file changing.
describe('environment.prod (ACC-130)', () => {
  it('calls the API at https://api.accreditme.app/api/v1', () => {
    expect(environment.apiUrl).toBe('https://api.accreditme.app/api/v1');
  });

  it('serves the API on the same site as every organisation, so the session cookies are sent', () => {
    const api = new URL(environment.apiUrl);
    expect(api.protocol).toBe('https:');
    expect(api.hostname).toBe(`api.${environment.baseDomain}`);
    expect(environment.baseDomain).toBe('accreditme.app');
  });
});
