import { PartialType } from '@nestjs/mapped-types';
import { CreateLookupValueDto } from './create-lookup-value.dto';

export class UpdateLookupValueDto extends PartialType(CreateLookupValueDto) {}
