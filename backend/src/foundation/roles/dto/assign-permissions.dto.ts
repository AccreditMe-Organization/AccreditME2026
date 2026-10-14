import { IsArray, IsString } from 'class-validator';

export class AssignPermissionsDto {
  // Full replacement set for the role — see Business Rules,
  // "Full-replace semantics" in the Step 4 plan.
  //
  // ACC-120 slice 5 (D6) — MAY BE EMPTY. A role that grants nothing is a real
  // state (one being prepared, or one emptied on purpose), and the case the old
  // ArrayNotEmpty actually protected — emptying Organization Administrator — is
  // refused by the root-role freeze, not by this list's length.
  @IsArray()
  @IsString({ each: true })
  permissionKeys!: string[];

  // ACC-120 slice 5 (D4) — the set the caller LOADED. The save is refused with
  // 409 ROLE_PERMISSIONS_CHANGED if the role's set is no longer exactly this
  // one, so a stale page cannot overwrite someone else's save.
  //
  // REQUIRED since the matrix rebuild (PR B), which sends it: a save that does
  // not say what it saw cannot be told apart from a stale one, so a missing
  // value is 400. It was optional for one release only, so a tab left open
  // across that deploy kept saving. MAY BE EMPTY, for a role that held nothing.
  @IsArray()
  @IsString({ each: true })
  expectedPermissionKeys!: string[];
}
