---
name: module-scaffold
description: NestJS module structure rules for AccreditMe. Invoke manually with /module-scaffold when creating any new backend module.
disable-model-invocation: true
allowed-tools: Read Glob Grep Write Edit Bash(npx tsc --noEmit) Bash(npx jest *) Bash(git add src/*) Bash(git commit *) Bash(git status *)
---

# AccreditMe — NestJS Module Scaffold Rules

Read this skill completely before creating any new NestJS module.
Every module in AccreditMe follows this exact structure.
Consistency across modules makes the codebase navigable and maintainable.
Never deviate from this structure without explicit instruction.

---

## Layer Reference

Every module belongs to exactly one layer:

```
foundation/     → auth, committees, lookup, notification, org-position,
                  organization, roles, task, tenant, user, workflow,
                  working-calendar
modules/        → standards, documents, quality-improvement, audit
                  (not yet built — target layout for future modules)
platform/       → super admin portal only
providers/      → auth, storage, ai implementations
common/         → guards, decorators, filters, interceptors, pipes
```

Verified against the actual `backend/src/foundation/` folder listing —
re-check with `ls backend/src/foundation` if this list is ever in
doubt, rather than trusting it from memory. Meeting Management is not
built yet and has no folder here; do not scaffold against a "meetings"
path that doesn't exist.

---

## Required File Structure

Every module must have exactly this structure — no more, no less:

```
backend/src/{layer}/{module-name}/
├── {module-name}.module.ts
├── {module-name}.controller.ts
├── {module-name}.controller.spec.ts
├── {module-name}.service.ts
├── {module-name}.service.spec.ts
├── dto/
│   ├── create-{module-name}.dto.ts
│   ├── update-{module-name}.dto.ts
│   └── {module-name}-response.dto.ts
└── interfaces/
    └── {module-name}.interface.ts
```

---

## Module File

```typescript
// {module-name}.module.ts
import { Module } from '@nestjs/common';
import { {ModuleName}Controller } from './{module-name}.controller';
import { {ModuleName}Service } from './{module-name}.service';

@Module({
  controllers: [{ModuleName}Controller],
  providers: [{ModuleName}Service],
  exports: [{ModuleName}Service],
})
export class {ModuleName}Module {}
```

After creating — register the module in its parent module imports array.
Foundation modules → AppModule.
Functional modules → their feature module.

---

## Controller Rules

Controllers handle routing and input validation ONLY.
Zero business logic. Zero direct Prisma calls. Ever.

```typescript
// {module-name}.controller.ts
import { Controller, Get, Post, Patch, Delete, Body, Param, UseGuards } from '@nestjs/common';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { PermissionGuard } from '../../common/guards/permission.guard';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { CurrentTenant } from '../../common/decorators/current-tenant.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { {ModuleName}Service } from './{module-name}.service';
import { Create{ModuleName}Dto } from './dto/create-{module-name}.dto';
import { Update{ModuleName}Dto } from './dto/update-{module-name}.dto';

@Controller('{module-name}')
@UseGuards(TenantGuard, PermissionGuard)
export class {ModuleName}Controller {
  constructor(private readonly {moduleName}Service: {ModuleName}Service) {}

  @Get()
  @Permissions('{module-name}:view')
  findAll(@CurrentTenant() tenantId: string) {
    return this.{moduleName}Service.findAll(tenantId);
  }

  @Get(':id')
  @Permissions('{module-name}:view')
  findOne(@Param('id') id: string, @CurrentTenant() tenantId: string) {
    return this.{moduleName}Service.findOne(id, tenantId);
  }

  @Post()
  @Permissions('{module-name}:create')
  create(
    @Body() dto: Create{ModuleName}Dto,
    @CurrentTenant() tenantId: string,
    @CurrentUser() userId: string,
  ) {
    return this.{moduleName}Service.create(dto, tenantId, userId);
  }

  @Patch(':id')
  @Permissions('{module-name}:update')
  update(
    @Param('id') id: string,
    @Body() dto: Update{ModuleName}Dto,
    @CurrentTenant() tenantId: string,
    @CurrentUser() userId: string,
  ) {
    return this.{moduleName}Service.update(id, dto, tenantId, userId);
  }

  @Delete(':id')
  @Permissions('{module-name}:delete')
  remove(
    @Param('id') id: string,
    @CurrentTenant() tenantId: string,
    @CurrentUser() userId: string,
  ) {
    return this.{moduleName}Service.remove(id, tenantId, userId);
  }
}
```

### Controller checklist before committing:

- @UseGuards(TenantGuard, PermissionGuard) at class level ✓
- @Permissions('{module}:{action}') at every method ✓
- Zero business logic ✓
- Zero direct Prisma calls ✓
- All inputs go through DTOs ✓

---

## Service Rules

Services contain ALL business logic.
Every method receives tenantId as a parameter — always from JWT, never from request body.
Every Prisma query includes `{ organizationId: tenantId }` — no exceptions.

```typescript
// {module-name}.service.ts
import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogService } from '../../common/services/audit-log.service';
import { Create{ModuleName}Dto } from './dto/create-{module-name}.dto';
import { Update{ModuleName}Dto } from './dto/update-{module-name}.dto';

@Injectable()
export class {ModuleName}Service {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLog: AuditLogService,
    // Add WorkflowService if module has workflow integration
    // Add NotificationService if module sends notifications
    // Add WorkingCalendarService if module has SLA or due dates
    // Add TaskService if module generates tasks
  ) {}

  async findAll(tenantId: string) {
    // organizationId ALWAYS included — no exceptions
    return this.prisma.{modelName}.findMany({
      where: { organizationId: tenantId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(id: string, tenantId: string) {
    const record = await this.prisma.{modelName}.findFirst({
      where: {
        id,
        organizationId: tenantId,  // always scope by tenant
      },
    });

    if (!record) {
      throw new NotFoundException(`{ModuleName} not found`);
    }

    return record;
  }

  async create(dto: Create{ModuleName}Dto, tenantId: string, userId: string) {
    const record = await this.prisma.{modelName}.create({
      data: {
        ...dto,
        organizationId: tenantId,  // always from JWT, never from dto
        createdBy: userId,
      },
    });

    await this.auditLog.log({
      action: 'CREATE',
      objectType: '{ModuleName}',
      objectId: record.id,
      actorId: userId,
      tenantId,
      after: record,
    });

    return record;
  }

  async update(id: string, dto: Update{ModuleName}Dto, tenantId: string, userId: string) {
    // findOne already validates tenant ownership
    const existing = await this.findOne(id, tenantId);

    const record = await this.prisma.{modelName}.update({
      where: { id },
      data: dto,
    });

    await this.auditLog.log({
      action: 'UPDATE',
      objectType: '{ModuleName}',
      objectId: record.id,
      actorId: userId,
      tenantId,
      before: existing,
      after: record,
    });

    return record;
  }

  async remove(id: string, tenantId: string, userId: string) {
    // findOne already validates tenant ownership
    const existing = await this.findOne(id, tenantId);

    await this.prisma.{modelName}.delete({
      where: { id },
    });

    await this.auditLog.log({
      action: 'DELETE',
      objectType: '{ModuleName}',
      objectId: id,
      actorId: userId,
      tenantId,
      before: existing,
    });
  }
}
```

### Service checklist before committing:

- Every method receives tenantId as parameter ✓
- Every Prisma query includes organizationId: tenantId ✓
- findOne validates ownership before update/delete ✓
- AuditLogService called on every create/update/delete ✓
- organizationId never accepted from dto ✓
- WorkingCalendarService used for any date/SLA calculation ✓

---

## DTO Rules

All DTOs use class-validator decorators.
Never accept organizationId, createdBy, tenantId, or updatedBy from request body.
These are always set in the service from JWT context.

```typescript
// dto/create-{module-name}.dto.ts
import { IsString, IsNotEmpty, IsOptional, IsUUID, MaxLength, IsEnum } from 'class-validator';
import { Transform } from 'class-transformer';

export class Create{ModuleName}Dto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  @Transform(({ value }) => value?.trim())
  name: string;

  @IsString()
  @IsOptional()
  @MaxLength(2000)
  @Transform(({ value }) => value?.trim())
  description?: string;

  // Add fields specific to this module
  // NEVER include: organizationId, createdBy, tenantId, updatedBy
}

// dto/update-{module-name}.dto.ts
import { PartialType } from '@nestjs/mapped-types';
import { Create{ModuleName}Dto } from './create-{module-name}.dto';

export class Update{ModuleName}Dto extends PartialType(Create{ModuleName}Dto) {}
```

---

## Interface Rules

Define the domain object shape as a TypeScript interface.
Used for type safety across services that reference this module.

```typescript
// interfaces/{module-name}.interface.ts
export interface I{ModuleName} {
  id: string;
  organizationId: string;
  name: string;
  description?: string;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
}
```

---

## Unit Test Rules

Every service must have tests before committing.
These are the minimum required tests per service method.

```typescript
// {module-name}.service.spec.ts
import { Test, TestingModule } from '@nestjs/testing';
import { {ModuleName}Service } from './{module-name}.service';
import { PrismaService } from '../../prisma/prisma.service';

describe('{ModuleName}Service', () => {
  let service: {ModuleName}Service;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        {ModuleName}Service,
        {
          provide: PrismaService,
          useValue: { {modelName}: { findMany: jest.fn(), findFirst: jest.fn(), create: jest.fn(), update: jest.fn(), delete: jest.fn() } },
        },
        { provide: AuditLogService, useValue: { log: jest.fn() } },
      ],
    }).compile();
    service = module.get<{ModuleName}Service>({ModuleName}Service);
  });

  describe('findAll', () => {
    it('should return records for the correct tenant', async () => {
      // Arrange + Act + Assert
    });

    // MANDATORY — tenant isolation test for every query method
    it('should NOT return records belonging to a different tenant', async () => {
      const tenantA = 'tenant-a-id';
      const tenantB = 'tenant-b-id';
      // Create mock records for both tenants
      // Call service with tenantA
      // Assert tenantB records are NOT in results
      // This test must pass before any PR is opened
    });
  });

  describe('create', () => {
    it('should set organizationId from tenantId parameter not from dto', async () => {});
    it('should log to audit trail on creation', async () => {});
    it('should NOT allow organizationId override from dto', async () => {});
  });

  describe('update', () => {
    it('should update only records belonging to current tenant', async () => {});
    it('should throw NotFoundException for records from different tenant', async () => {});
    it('should log to audit trail on update', async () => {});
  });

  describe('remove', () => {
    it('should delete only records belonging to current tenant', async () => {});
    it('should throw NotFoundException for records from different tenant', async () => {});
    it('should log to audit trail on deletion', async () => {});
  });
});
```

Run tests before committing:

```bash
cd backend && npx jest --testPathPattern={module-name}
```

All tests must pass. The tenant isolation test is non-negotiable.

---

## Permission Strings

Add permission strings for the new module to:
`backend/src/common/constants/permissions.ts`

```typescript
export const {MODULE_NAME}_PERMISSIONS = {
  VIEW:   '{module-name}:view',
  CREATE: '{module-name}:create',
  UPDATE: '{module-name}:update',
  DELETE: '{module-name}:delete',
  // Add module-specific actions as needed:
  // SUBMIT:   '{module-name}:submit',
  // APPROVE:  '{module-name}:approve',
  // PUBLISH:  '{module-name}:publish',
  // EXPORT:   '{module-name}:export',
} as const;
```

---

## TypeScript Verification

Run after completing all files:

```bash
cd backend && npx tsc --noEmit
```

Must produce zero errors before committing.

---

## Final Checklist Before Committing Any Module File

- [ ] File structure matches the template exactly
- [ ] Controller has zero business logic
- [ ] Every service method accepts tenantId as parameter
- [ ] Every Prisma query includes organizationId: tenantId
- [ ] DTOs do not accept organizationId or createdBy from request
- [ ] TenantGuard and PermissionGuard on controller class level
- [ ] @Permissions decorator on every endpoint method
- [ ] AuditLogService called on every create/update/delete
- [ ] Tenant isolation test written for every findMany/findOne
- [ ] All tests passing: npx jest --testPathPattern={module-name}
- [ ] TypeScript errors: zero — npx tsc --noEmit
- [ ] Module registered in parent module imports array
- [ ] Module exported if other modules need its service
- [ ] Permission strings added to permissions.ts
