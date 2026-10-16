import { IAiBalance, IAiFeatureOpen, IAiFeatureUsage } from '../../ai/ai-balance';
import { ITenant } from '../interfaces/tenant.interface';

export class TenantResponseDto implements ITenant {
  id!: string;
  name!: string;
  nameAr!: string | null;
  slug!: string;
  country!: string;
  timezone!: string;
  language!: string;
  authProvider!: 'LOCAL' | 'AZURE_AD' | 'GOOGLE';
  storageProvider!: 'S3' | 'MINIO' | 'LOCAL_FILESYSTEM' | 'SHAREPOINT';
  aiProvider!: 'ANTHROPIC' | 'AZURE_OPENAI' | 'OPENAI' | 'OLLAMA';
  plan!: 'STARTER' | 'PROFESSIONAL' | 'ENTERPRISE';
  status!: 'TRIAL' | 'ACTIVE' | 'SUSPENDED' | 'CANCELLED' | 'OFFBOARDING';
  trialEndsAt!: Date | null;
  maxUsers!: number;
  maxStorageGb!: number;
  isBootstrapped!: boolean;
  bootstrappedAt!: Date | null;
  logo!: string | null;
  isPlatformOrg!: boolean;
  modules!: Record<string, boolean>;
  ai!: IAiBalance & { features: IAiFeatureOpen[]; usage: IAiFeatureUsage[] }; // ACC-194, usage ACC-120 slice 8
  createdAt!: Date;
  updatedAt!: Date;
}
