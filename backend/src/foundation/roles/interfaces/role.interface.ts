export interface IRole {
  id: string;
  organizationId: string;
  key: string | null;
  nameEn: string;
  nameAr: string | null;
  description: string | null;
  isSystem: boolean;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
  // Populated as "module:action" strings only when a role is requested WITH
  // DETAIL — getRoleById() via attachPermissions(). Absent on list responses
  // by design (step-04 §Data Model).
  permissions?: string[];
  // ACC-74 — the count, for list views that render a number rather than the
  // set. Separate from `permissions` above rather than derived from it,
  // because the list deliberately does not carry the array:
  //
  //   - step-04 specified "permission count" as a Roles-list column AND
  //     `permissions` as detail-only. Nothing was specified to carry the
  //     count on a list, so role-list bound to `permissions?.length` and
  //     rendered 0 for every role, always.
  //   - Populating `permissions` on the list instead would send every
  //     permission string for every role — 70 for Organization Administrator
  //     — to render one number.
  //
  // Resolved with one grouped query, never a per-role fetch. See
  // RoleService.getRoles().
  permissionCount?: number;

  // ACC-120 — list-only, same reasoning as permissionCount: how many people
  // hold this role AND can sign in (User.status ACTIVE, joined). Absent from
  // detail responses.
  //
  // It exists so the Manage roles dialog can render the ROOT ROLE's row as
  // locked for its last active holder, instead of offering a checkbox whose
  // save the server refuses. Counting raw assignments here would be worse than
  // not having it: the dialog would believe a deactivated user still covers the
  // tenant and would offer exactly the removal that locks everyone out.
  activeHolderCount?: number;
}
