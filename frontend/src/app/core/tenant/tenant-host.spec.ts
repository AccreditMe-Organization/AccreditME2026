import { DOCUMENT } from '@angular/common';
import { TestBed } from '@angular/core/testing';
import { environment } from '../../../environments/environment';
import { INFRASTRUCTURE_LABELS } from './reserved-labels';
import { TenantHostService, tenantSlugFromHost } from './tenant-host';

// ACC-139 — the organisation is the one label in front of the base domain.
describe('tenantSlugFromHost (ACC-139)', () => {
  it('reads the organisation from a local host', () => {
    expect(tenantSlugFromHost('al-nakheel.localhost', 'localhost')).toBe('al-nakheel');
    expect(tenantSlugFromHost('al-manara.localhost', 'localhost')).toBe('al-manara');
  });

  it('reads the organisation from a production host', () => {
    expect(tenantSlugFromHost('acme.accreditme.app', 'accreditme.app')).toBe('acme');
  });

  it('lower-cases the host, and accepts the fully qualified trailing dot', () => {
    expect(tenantSlugFromHost('Al-Nakheel.LOCALHOST', 'localhost')).toBe('al-nakheel');
    expect(tenantSlugFromHost('acme.accreditme.app.', 'accreditme.app')).toBe('acme');
  });

  it('accepts the platform sign-in host', () => {
    expect(tenantSlugFromHost('platform.localhost', 'localhost')).toBe('platform');
    expect(tenantSlugFromHost('platform.accreditme.app', 'accreditme.app')).toBe('platform');
  });

  it('names no organisation for the bare host or the apex', () => {
    expect(tenantSlugFromHost('localhost', 'localhost')).toBeNull();
    expect(tenantSlugFromHost('accreditme.app', 'accreditme.app')).toBeNull();
    expect(tenantSlugFromHost('127.0.0.1', 'localhost')).toBeNull();
  });

  it('names no organisation for two labels, or a host under another domain', () => {
    expect(tenantSlugFromHost('a.b.localhost', 'localhost')).toBeNull();
    expect(tenantSlugFromHost('acme.ward.accreditme.app', 'accreditme.app')).toBeNull();
    expect(tenantSlugFromHost('acme.accreditme.evil', 'accreditme.app')).toBeNull();
    expect(tenantSlugFromHost('acmeaccreditme.app', 'accreditme.app')).toBeNull();
  });

  it('names no organisation for an infrastructure label', () => {
    // Non-vacuity guard: the list is the real one, not empty.
    expect(INFRASTRUCTURE_LABELS.length).toBeGreaterThan(30);
    for (const label of ['www', 'api', ...INFRASTRUCTURE_LABELS]) {
      expect([label, tenantSlugFromHost(`${label}.accreditme.app`, 'accreditme.app')]).toEqual([label, null]);
    }
  });

  it('names no organisation for a label that is not a DNS label', () => {
    for (const host of ['-acme.localhost', 'acme-.localhost', 'xn--80ak6aa92e.localhost', `${'a'.repeat(64)}.localhost`, 'ac_me.localhost']) {
      expect([host, tenantSlugFromHost(host, 'localhost')]).toEqual([host, null]);
    }
  });
});

describe('TenantHostService (ACC-139)', () => {
  function slugAt(hostname: string): string | null {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [{ provide: DOCUMENT, useValue: { location: { hostname } } }],
    });
    return TestBed.inject(TenantHostService).slug;
  }

  // Pinned by reading it: every test above passes the base domain explicitly,
  // so this is what makes the service's own default the development one.
  it('uses localhost as the base domain in development', () => {
    expect(environment.baseDomain).toBe('localhost');
  });

  it("reads the page's own address", () => {
    expect(slugAt('al-nakheel.localhost')).toBe('al-nakheel');
    expect(slugAt('localhost')).toBeNull();
  });
});
