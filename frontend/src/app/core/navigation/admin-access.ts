// ACC-123 — the permission that says a person administers this tenant.
//
// Its own file, and not a string literal at each site, for one reason: it is
// read in four places that must agree — the nav model (so the rail and
// ROUTE_PERMISSIONS both get it), the shell's product label, and every admin
// write control. A typo in any of them fails OPEN, because hasPermission()
// returns false for an unknown string and the affordance simply disappears —
// a defect that looks like a permission working correctly.
//
// It matches ADMIN_PERMISSIONS.ACCESS in backend/src/common/constants/
// permissions.ts. The two are separate declarations because the frontend does
// not import backend source; role.seed.spec.ts and this file's own spec pin
// each side.
export const ADMIN_ACCESS = 'admin:access';
