# ACC-120 slice 5b — the Manage roles gaps

Plan written 15 Oct 2026 (CC-107). Branch `feature/ACC-120-manage-roles-gaps`,
from dev at e972b57.

This is section H of `step-120-5-permission-matrix.md`: the gaps found while
planning the matrix, in
`frontend/src/app/foundation/roles/components/manage-roles/manage-roles.component.ts`.
The design source is `AccreditMe Users and Roles.dc.html`, Manage roles panel A
(panel B is struck).

## The three fixes

1. **Errors are translated, never the server's text.** The load error and each
   row's save error came from `extractErrorMessage()`, so the server's English
   reached an Arabic session. Each refusal code below gets its own sentence in
   `en.json` and `ar.json`, with one translated fallback for anything else,
   for the load and for a row's save. This follows the matrix's pattern
   (`refusalCode()` plus status, mapped to `roles.matrix.*` keys). The mapping
   lives in one file, `manage-roles-refusal.ts`.
2. **Real tokens.**
   - Replace `--am-danger-600`, `--am-warning-700` and `--am-warning-50`, none
     of which exists, with `--am-danger-ink`, `--am-warning-ink` and
     `--am-warning-bg`.
   - Drop the literal fallback colours that hid them.
   - `check:contrast` gains the rule that would have caught them: an `--am-*`
     token used but defined nowhere fails (unless the use carries a
     non-colour fallback, an override hook such as `--am-list-actions`), and
     so does any `var(--am-…, <colour>)`.
   - The second rule also catches overlay-select's two `#64b5d9` fallbacks on
     `--am-blue-light`, which are removed.
3. **The drawn 403.**
   - A save refused 403 shows the drawn sentence: "You no longer have
     permission to change roles. Nothing was saved."
   - A load refused 403 shows its own sentence instead of a generic error.
     `GET users/:id/roles` needs `roles:view`, plus `users:view` for anyone but
     yourself (ACC-101), and `GET /roles` needs `roles:view`. The design draws
     no load-403 state, because it assumes the dialog can't be opened without
     `roles:manage`. But a `roles:manage` holder without `users:view` reaches
     it.

## Every refusal the dialog can receive, from the backend code

| Call | Status | Code | Where |
|---|---|---|---|
| load: `GET users/:id/roles` | 403 | none (Required permission: users:view) | `UserService.getUserRolesForViewer()` |
| load: `GET users/:id/roles`, `GET /roles` | 403 | none (Required permission: roles:view) | `PermissionGuard` |
| load: `GET users/:id/roles` | 404 | none (User not found) | `UserService.getById()` |
| add: `POST users/:id/roles` | 403 | none (Required permission: roles:manage) | `PermissionGuard` |
| add | 404 | **`ROLE_NOT_FOUND`** (new) | `RoleService.assignRoleToUser()` |
| add | 400 | `PLATFORM_ROLE_NOT_ASSIGNABLE` | `RoleService.assignRoleToUser()` (R1) |
| add | 404 | **`USER_NOT_FOUND`** (new) | `RoleService.assignRoleToUser()` |
| add | 409 | **`ROLE_ALREADY_HELD`** (new) | `RoleService.assignRoleToUser()` |
| add | 400 | none (validation: `roleId`) | `AssignRoleDto` |
| remove: `DELETE users/:id/roles/:roleId` | 403 | none (Required permission: roles:manage) | `PermissionGuard` |
| remove | 404 | **`ROLE_NOT_FOUND`** (new) | `RoleService.removeRoleFromUser()` |
| remove | 404 | **`ROLE_ASSIGNMENT_NOT_FOUND`** (new) | `RoleService.removeRoleFromUser()` |
| remove | 409 | **`ROLE_FROM_HEAD_POSITION`** (new) | `RoleService.removeRoleFromUser()` |
| remove | 409 | **`LAST_ACTIVE_ADMINISTRATOR`** (new) | `assertTenantRetainsAnActiveAdministrator()` |
| any | 429 | `RATE_LIMITED` | `AccreditMeThrottlerGuard` |
| any | 401 | `SESSION_OTHER_ORGANIZATION` or none | `TenantGuard`; the auth interceptor handles 401 |

## Where the code forces a departure

**Five of the refusals carried no code**, only an English message. The
frontend can't map a message to a sentence without parsing English, which is
the habit this fixes.

So the backend gains the five codes in bold above. Each is a subclass of the
same exception (`NotFoundException` or `ConflictException`), with the same
status and the same English message, plus a `code`. Every existing caller and
spec sees the same type and text.

`LAST_ACTIVE_ADMINISTRATOR` is shared by every path the invariant guards: role
deactivation, a permission save, removing a role, and deactivating a user. A
code there changes nothing for those callers.

The 403s and the load 404 stay as they are: the status alone decides their
sentence.

**A failed row's reason moves under the role name.** Today it sits in the
row's no-wrap right-hand column, where a whole sentence would push the row
past the dialog. The column keeps a short "Failed".
