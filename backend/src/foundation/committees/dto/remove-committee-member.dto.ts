import { Transform } from 'class-transformer';
import { IsDateString, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

// ACC-298 (Ahmad, 11 Nov): "removal from committee requires a reason." It is
// stored on the membership's LEFT event, and ACC-297's notice to the committee's
// officers shows it. Trimmed BEFORE it is checked, so whitespace alone is not a
// reason; the trimmed value is what is stored. Earlier removals keep their null.
const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class RemoveCommitteeMemberDto {
  @IsDateString()
  @IsOptional()
  effectiveDate?: string;

  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  reason!: string;
}
