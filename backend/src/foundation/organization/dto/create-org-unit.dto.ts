import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsInt,
  MaxLength,
  Matches,
  Min,
} from 'class-validator';
import { Transform } from 'class-transformer';

export class CreateOrgUnitDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  @Transform(({ value }: { value: string }) => value?.trim())
  nameEn!: string;

  @IsString()
  @IsOptional()
  @MaxLength(255)
  @Transform(({ value }: { value: string }) => value?.trim())
  nameAr?: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(10)
  @Matches(/^[A-Z0-9-]+$/, {
    message: 'code must be uppercase letters, numbers, and hyphens only',
  })
  code!: string;

  // `string | null`, not `string`, because the runtime already allowed null and
  // the type was hiding it (ACC-134). `@IsOptional()` skips every other
  // validator for BOTH null and undefined, so `{"parentId": null}` has always
  // passed validation and reached the service — which is how a unit was
  // promoted to root, and the case ACC-134 has to refuse.
  //
  // Declaring it honestly matters beyond tidiness: with `parentId?: string`,
  // the service's `dto.parentId === null` branch is unreachable *to the type
  // checker*, so the next reader deletes it as dead code and the second-root
  // refusal silently disappears. The two states are NOT interchangeable —
  // undefined means "leave the parent alone", null means "make this a root".
  @IsString()
  @IsOptional()
  parentId?: string | null;

  /**
   * ACC-137 — REQUIRED on create, and the service validates it resolves.
   *
   * The ticket's phrase is "nullable in the database, required in the API", and
   * the two are not in tension. The column is nullable because the PLATFORM
   * organization's root is not a tenant org unit and no org_unit_type value is
   * meaningful for it — a permanent structural exception, not a migration
   * backlog. That row is created by `demo-seed.ts` writing Prisma directly, so
   * it never passes through this DTO, which is why the exemption needs no
   * carve-out here. A validator branch for it would be inventing a rule the
   * decision did not make.
   */
  @IsString()
  @IsNotEmpty()
  typeValueId!: string;

  /**
   * ACC-137 — the superseded free-text field, kept only for the expand step.
   *
   * No longer read: `create()` and `update()` write this column from the
   * RESOLVED value's key, so the two cannot drift. It stays in the DTO so a
   * caller still sending it is not rejected by `forbidNonWhitelisted`, which
   * would turn a harmless stale field into a 400 during the deploy window.
   */
  @IsString()
  @IsOptional()
  type?: string;

  @IsString()
  @IsOptional()
  @MaxLength(1000)
  description?: string;

  @IsInt()
  @IsOptional()
  @Min(0)
  sortOrder?: number;
}
