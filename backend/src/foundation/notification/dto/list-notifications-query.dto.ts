import { IsIn, IsOptional } from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';

// ACC-78 — see ListUsersQueryDto for why this exists rather than a separate
// @Query('status') parameter. This endpoint had the same latent 400: it was
// never reached only because both current callers (the bell and the home
// page) pass no status at all. A filter added to either one would have hit it.
export class ListNotificationsQueryDto extends PaginationQueryDto {
  @IsIn(['UNREAD', 'READ', 'DISMISSED'])
  @IsOptional()
  status?: 'UNREAD' | 'READ' | 'DISMISSED';
}
