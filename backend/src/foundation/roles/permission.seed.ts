import * as PermissionConstants from '../../common/constants/permissions';

export interface SeedPermission {
  module: string;
  action: string;
  description: string;
}

// Flattens every {X}_PERMISSIONS constant object into {module, action} pairs.
// Module name is the string before ':' in each permission value (e.g. "documents:view" → "documents").
// Derived from permissions.ts rather than duplicated so the two can never drift apart.
export const ALL_PERMISSIONS: SeedPermission[] = Object.values(PermissionConstants)
  .flatMap((group) => Object.values(group as Record<string, string>))
  .map((value) => {
    const [module, action] = value.split(':') as [string, string];
    return { module, action, description: value };
  });
