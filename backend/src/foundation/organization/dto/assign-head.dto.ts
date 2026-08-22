import { IsNotEmpty, IsString } from 'class-validator';

// ACC-40 Section 2.3 — direct appointment to a head-conferring position,
// no handover, e.g. filling a vacancy. positionId is caller-supplied
// (not inferred) since a vacant unit has no outgoing holder to copy it
// from, unlike declareHandover().
export class AssignHeadDto {
  @IsString()
  @IsNotEmpty()
  userId!: string;

  @IsString()
  @IsNotEmpty()
  positionId!: string;
}
