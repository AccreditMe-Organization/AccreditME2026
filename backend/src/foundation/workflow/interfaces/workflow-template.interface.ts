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
  recordActions?: { key: string; labelKey: string }[];
  stageFlags?: { key: string; labelKey: string; cardinality: 'any' | 'exactlyOne' }[];
  recordFields?: { key: string; labelKey: string; kind: 'lookup' | 'orgUnit' }[];
}
