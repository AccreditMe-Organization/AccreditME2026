export enum PlanModuleAccessLevel {
  FULL = 'FULL',
  READ_ONLY = 'READ_ONLY',
  NONE = 'NONE',
}

export interface IPlan {
  id: string;
  name: string;
  nameEn: string;
  nameAr: string;
  monthlyPrice: string;
  annualPrice: string;
  maxFullUsers: number | null;
  maxStaff: number | null;
  maxStorageGb: number;
  aiCreditsPerMonth: number;
  isActive: boolean;
  isPublic: boolean;
  sortOrder: number;
  createdAt: Date;
  updatedAt: Date;
  planModules?: IPlanModule[];
}

export interface IPlanModule {
  id: string;
  planId: string;
  moduleKey: string;
  accessLevel: PlanModuleAccessLevel;
}

export interface IAiCreditPack {
  id: string;
  name: string;
  nameAr: string | null;
  credits: number;
  price: string;
  isActive: boolean;
  availableTo: string[];
  sortOrder: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface IAiFeatureCost {
  id: string;
  featureKey: string;
  creditCost: number;
  description: string | null;
  createdAt: Date;
  updatedAt: Date;
}
