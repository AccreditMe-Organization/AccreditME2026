import { IWorkflowStage } from './workflow-stage.interface';

export interface IWorkflowTemplate {
  id: string;
  organizationId: string;
  nameEn: string;
  nameAr: string;
  objectType: string; // WorkflowObjectType — kept as string at the interface
                       // boundary so DTOs can validate with @IsEnum without a
                       // runtime import of the generated Prisma enum
  isDefault: boolean;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
  stages?: IWorkflowStage[]; // populated when requested with detail
}
