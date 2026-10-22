import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

const toBoolean = ({ value }: { value: unknown }) => (value === 'true' ? true : value === 'false' ? false : value);

/** ACC-120 slice 11 — `GET /organization/units/structure`. */
export class OrgStructureQueryDto {
  /** Inactive units too. Honoured only for a caller with `org:manage`. */
  @Transform(toBoolean)
  @IsBoolean()
  @IsOptional()
  includeInactive?: boolean;
}

/** ACC-120 slice 11 — `GET /organization/units/chart`. */
export class OrgChartQueryDto {
  /** The unit the window starts from. Omitted: the organisation's top unit. */
  @IsString()
  @IsOptional()
  rootId?: string;

  /** Levels from the root, the root included. Capped at 4, not refused above it. */
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @IsOptional()
  depth?: number;
}

/** ACC-120 slice 11, PR D — `GET /organization/units/:id/history`. */
export class OrgUnitHistoryQueryDto {
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @IsOptional()
  skip?: number;

  /** At most 50 a page. */
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  @IsOptional()
  take?: number;
}
