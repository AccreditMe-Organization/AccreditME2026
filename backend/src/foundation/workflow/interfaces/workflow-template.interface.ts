import { IWorkflowStage } from './workflow-stage.interface';
import { TaskDueHours } from './stage-task-definition.interface';

export interface IWorkflowTemplate {
  id: string;
  organizationId: string;
  nameEn: string;
  nameAr: string | null;
  objectType: string; // WorkflowObjectType — kept as string at the interface
                       // boundary so DTOs can validate with @IsEnum without a
                       // runtime import of the generated Prisma enum
  isDefault: boolean;
  isActive: boolean;
  // ACC-255 PR 4b-be (G6) — whether AccreditMe keeps this template's shape
  // fixed (PROTECTED_TEMPLATES): its stages may be renamed and given deadlines,
  // nothing else. On every template read, list and detail, so a screen renders
  // the protected state from the server's own rule rather than a copy of it.
  isProtected: boolean;
  // ACC-255 PR 4b (Ahmad's Q2) — on a protected template only: the stage fields
  // its stages may still change, read from the same set updateStage() checks
  // (PROTECTED_STAGE_EDITABLE), so the stage editor shows every other field
  // read-only instead of offering a change the server refuses.
  editableStageFields?: string[];
  createdAt: Date;
  updatedAt: Date;
  stages?: IWorkflowStage[]; // populated when requested with detail
  // ACC-208 — detail only. Which relative assignment routes this template's
  // record type can resolve, read from RECORD_ROUTES so no screen keeps a copy
  // of the registry (B2); and each priority's due time, for the stage task
  // dialog (B3), which a workflows:manage holder may not otherwise read.
  recordRoutes?: { unit: boolean; committee: boolean };
  taskDueHours?: TaskDueHours;
  // ACC-255 — detail only. What this template's record type offers a stage,
  // read from the registries (record-registry.ts) so no screen keeps a copy:
  // the actions a stage may allow, the flags it may carry, and the record
  // fields a later condition may read. Keys and label keys only.
  // ACC-255 PR 4b-be (G1): each action's permissionKey, the permission its
  // own endpoint checks, which a person needs as well as the stage's allowance.
  recordActions?: { key: string; labelKey: string; permissionKey: string }[];
  stageFlags?: { key: string; labelKey: string; cardinality: 'any' | 'exactlyOne' }[];
  recordFields?: { key: string; labelKey: string; kind: 'lookup' | 'orgUnit' }[];
}
