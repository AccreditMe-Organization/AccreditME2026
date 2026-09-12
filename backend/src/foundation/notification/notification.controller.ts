import { Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { CurrentTenant } from '../../common/decorators/current-tenant.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { NotificationService } from './notification.service';
import { INotification } from './interfaces/notification.interface';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { IPaginatedResponse } from '../../common/interfaces/paginated-response.interface';

// No @Permissions() on any endpoint here, and no PermissionGuard — a user's
// own notification inbox is not permission-gated content, it is intrinsically
// self-scoped (every query filters userId = the calling user). TenantGuard
// still runs alone for authentication and @CurrentTenant()/@CurrentUser()
// population. See plan Business Rules — "Permission Model for the Personal
// Inbox". There is also deliberately no POST /notifications endpoint —
// notifications are always system/workflow-generated, never user-authored.
@Controller('notifications')
@UseGuards(TenantGuard)
export class NotificationController {
  constructor(private readonly notificationService: NotificationService) {}

  // ACC-78 — page-based, and returns a total. `status` stays a plain @Query
  // rather than joining the DTO: it is this endpoint's own filter, not part of
  // the shared list contract.
  @Get()
  getForUser(
    @CurrentTenant() tenantId: string,
    @CurrentUser() userId: string,
    @Query() pagination: PaginationQueryDto,
    @Query('status') status?: 'UNREAD' | 'READ' | 'DISMISSED',
  ): Promise<IPaginatedResponse<INotification>> {
    return this.notificationService.getForUser(userId, tenantId, {
      status,
      page: pagination.page,
      pageSize: pagination.pageSize,
      sortBy: pagination.sortBy,
      sortDir: pagination.sortDir,
    });
  }

  @Get('unread-count')
  async getUnreadCount(
    @CurrentTenant() tenantId: string,
    @CurrentUser() userId: string,
  ): Promise<{ count: number }> {
    const count = await this.notificationService.getUnreadCount(userId, tenantId);
    return { count };
  }

  @Patch(':id/read')
  markRead(
    @Param('id') id: string,
    @CurrentTenant() tenantId: string,
    @CurrentUser() userId: string,
  ): Promise<INotification> {
    return this.notificationService.markRead(id, userId, tenantId);
  }

  @Post('mark-all-read')
  markAllRead(
    @CurrentTenant() tenantId: string,
    @CurrentUser() userId: string,
  ): Promise<{ count: number }> {
    return this.notificationService.markAllRead(userId, tenantId);
  }
}
