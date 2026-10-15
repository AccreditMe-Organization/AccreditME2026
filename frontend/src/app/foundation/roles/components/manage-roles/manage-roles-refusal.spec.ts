import { HttpErrorResponse } from '@angular/common/http';
import { manageRolesRefusalKey } from './manage-roles-refusal';

// ACC-120 slice 5b — every refusal Manage roles can receive, mapped to ITS OWN
// sentence; anything else to one translated fallback per phase. The table in
// backend/Plans/step-120-5b-manage-roles-gaps.md is what this mirrors.
const refused = (status: number, code?: string, message = 'English from the server'): HttpErrorResponse =>
  new HttpErrorResponse({ status, error: { statusCode: status, message, ...(code ? { code } : {}) } });

describe('manageRolesRefusalKey (ACC-120 slice 5b)', () => {
  describe('a row save', () => {
    const CASES: [string, number, string][] = [
      ['PLATFORM_ROLE_NOT_ASSIGNABLE', 400, 'manageRoles.refusal.platformRoleNotAssignable'],
      ['ROLE_ALREADY_HELD', 409, 'manageRoles.refusal.alreadyHeld'],
      ['ROLE_FROM_HEAD_POSITION', 409, 'manageRoles.refusal.fromHeadPosition'],
      ['LAST_ACTIVE_ADMINISTRATOR', 409, 'manageRoles.refusal.lastAdministrator'],
      ['ROLE_NOT_FOUND', 404, 'manageRoles.refusal.roleNotFound'],
      ['USER_NOT_FOUND', 404, 'manageRoles.refusal.userNotFound'],
      ['ROLE_ASSIGNMENT_NOT_FOUND', 404, 'manageRoles.refusal.assignmentNotFound'],
      ['RATE_LIMITED', 429, 'manageRoles.refusal.rateLimited'],
    ];
    for (const [code, status, key] of CASES) {
      it(`${code} → its own sentence`, () => {
        expect(manageRolesRefusalKey(refused(status, code), 'save')).toBe(key);
      });
    }

    it('a 403 with no code → the drawn "no longer have permission" sentence', () => {
      expect(manageRolesRefusalKey(refused(403, undefined, 'Required permission: roles:manage'), 'save')).toBe(
        'manageRoles.refusal.saveForbidden',
      );
    });

    it('anything else → the one save fallback, never the server text', () => {
      expect(manageRolesRefusalKey(refused(500), 'save')).toBe('manageRoles.errorSaveRow');
      expect(manageRolesRefusalKey(refused(409, 'SOMETHING_NEW'), 'save')).toBe('manageRoles.errorSaveRow');
      expect(manageRolesRefusalKey(new Error('network'), 'save')).toBe('manageRoles.errorSaveRow');
    });
  });

  describe('the load', () => {
    it('a 403 → the load-forbidden sentence', () => {
      expect(manageRolesRefusalKey(refused(403, undefined, 'Required permission: users:view'), 'load')).toBe(
        'manageRoles.refusal.loadForbidden',
      );
    });

    it('a rate limit → its sentence', () => {
      expect(manageRolesRefusalKey(refused(429, 'RATE_LIMITED'), 'load')).toBe('manageRoles.refusal.rateLimited');
    });

    it('anything else → the one load fallback', () => {
      expect(manageRolesRefusalKey(refused(404), 'load')).toBe('manageRoles.errorLoad');
      expect(manageRolesRefusalKey(refused(500), 'load')).toBe('manageRoles.errorLoad');
      expect(manageRolesRefusalKey(new Error('network'), 'load')).toBe('manageRoles.errorLoad');
    });
  });
});
