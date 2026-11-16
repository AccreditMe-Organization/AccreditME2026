import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsISO8601, IsNotEmpty, IsString, ValidateNested } from 'class-validator';

// ACC-283 — PUT /committees/:id/seat-actions: the WHOLE map of what each seat
// allows on this committee. A seat left out allows nothing. Each action must be
// on the fixed list (SEAT_ACTION_UNKNOWN) and each seat one the organisation
// uses (SEAT_ACTION_SEAT_UNKNOWN), both checked in the service.

export class SeatActionsEntryDto {
  @IsString()
  @IsNotEmpty()
  roleValueId!: string;

  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  actions!: string[];
}

export class ReplaceSeatActionsDto {
  // The committee's `updatedAt` as the screen loaded it. A committee changed
  // since (its details or its seat actions) is refused, 409 COMMITTEE_CHANGED.
  @IsISO8601({ strict: true })
  expectedUpdatedAt!: string;

  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => SeatActionsEntryDto)
  seats!: SeatActionsEntryDto[];
}
