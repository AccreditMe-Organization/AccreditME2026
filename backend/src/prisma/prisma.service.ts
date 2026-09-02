import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../generated/prisma/client.js';

// Prisma 7 requires a driver adapter for direct database connections.
// The pg Pool reads DATABASE_URL from the environment.
// All DB queries MUST include organizationId scoping — enforced per service method.

function buildClient() {
  const pool = new Pool({ connectionString: process.env['DATABASE_URL'] });
  const adapter = new PrismaPg(pool);

  return new PrismaClient({ adapter }).$extends({
    // Block all mutations on AuditLog — append-only forever
    query: {
      auditLog: {
        async update() {
          throw new Error('AuditLog is append-only. UPDATE is forbidden.');
        },
        async updateMany() {
          throw new Error('AuditLog is append-only. UPDATE is forbidden.');
        },
        async upsert() {
          throw new Error('AuditLog is append-only. UPSERT is forbidden.');
        },
        async delete() {
          throw new Error('AuditLog is append-only. DELETE is forbidden.');
        },
        async deleteMany() {
          throw new Error('AuditLog is append-only. DELETE is forbidden.');
        },
      },
    },
  });
}

type ExtendedPrismaClient = ReturnType<typeof buildClient>;

@Injectable()
export class PrismaService implements OnModuleInit, OnModuleDestroy {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Prisma 7 $extends changes the return type; typed via getters below
  private readonly _client: ExtendedPrismaClient = buildClient();

  get organization() { return this._client.organization; }
  get user() { return this._client.user; }
  get role() { return this._client.role; }
  get permission() { return this._client.permission; }
  get userRole() { return this._client.userRole; }
  get rolePermission() { return this._client.rolePermission; }
  get lookupCategory() { return this._client.lookupCategory; }
  get lookupValue() { return this._client.lookupValue; }
  get orgUnit() { return this._client.orgUnit; }
  get orgPosition() { return this._client.orgPosition; }
  get orgUnitHeadEvent() { return this._client.orgUnitHeadEvent; }
  get userTransferEvent() { return this._client.userTransferEvent; }
  get workingCalendar() { return this._client.workingCalendar; }
  get publicHoliday() { return this._client.publicHoliday; }
  get workflowTemplate() { return this._client.workflowTemplate; }
  get workflowStage() { return this._client.workflowStage; }
  get workflowTransition() { return this._client.workflowTransition; }
  get workflowInstance() { return this._client.workflowInstance; }
  get workflowInstanceStage() { return this._client.workflowInstanceStage; }
  get workflowApproval() { return this._client.workflowApproval; }
  get workflowTransitionAction() { return this._client.workflowTransitionAction; }
  get workflowActionLog() { return this._client.workflowActionLog; }
  get task() { return this._client.task; }
  get taskAssignee() { return this._client.taskAssignee; }
  get taskEvidence() { return this._client.taskEvidence; }
  get notification() { return this._client.notification; }
  get committee() { return this._client.committee; }
  get committeeMember() { return this._client.committeeMember; }
  get committeeMembershipEvent() { return this._client.committeeMembershipEvent; }
  get meeting() { return this._client.meeting; }
  get agendaItem() { return this._client.agendaItem; }
  get auditLog() { return this._client.auditLog; }
  get aiInteractionLog() { return this._client.aiInteractionLog; }
  get authUser() { return this._client.authUser; }
  get authSession() { return this._client.authSession; }
  get authAccount() { return this._client.authAccount; }
  get authVerification() { return this._client.authVerification; }
  get authTwoFactor() { return this._client.authTwoFactor; }
  get loginAttempt() { return this._client.loginAttempt; }
  get refreshToken() { return this._client.refreshToken; }
  get plan() { return this._client.plan; }
  get planModule() { return this._client.planModule; }
  get aiCreditPack() { return this._client.aiCreditPack; }
  get aiFeatureCost() { return this._client.aiFeatureCost; }

  $transaction: ExtendedPrismaClient['$transaction'] =
    this._client.$transaction.bind(this._client);

  async onModuleInit(): Promise<void> {
    await this._client.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this._client.$disconnect();
  }
}
