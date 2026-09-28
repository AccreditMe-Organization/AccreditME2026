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
