export interface IPermission {
  id: string;
  module: string;
  action: string;
  description: string | null;
  // ACC-120 slice 5 (R2) — false for a key no code checks yet
  // (PERMISSIONS_NOT_YET_CHECKED). A role cannot gain such a key, and keeps one
  // it already holds.
  inUse: boolean;
  // ACC-258 — true for a key only the root role (Organization Administrator)
  // may hold (ROOT_ROLE_ONLY_PERMISSIONS). The role editor hides it on every
  // other role; no screen keeps its own list.
  rootRoleOnly: boolean;
}
