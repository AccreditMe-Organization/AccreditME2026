export interface ITenant {
  id: string;
  name: string;
  slug: string;
  country: string;
  timezone: string;
  language: string;
  authProvider: 'LOCAL' | 'AZURE_AD' | 'GOOGLE';
  storageProvider: 'S3' | 'MINIO' | 'LOCAL_FILESYSTEM';
  aiProvider: 'ANTHROPIC' | 'AZURE_OPENAI' | 'OPENAI' | 'OLLAMA';
  plan: 'STARTER' | 'PROFESSIONAL' | 'ENTERPRISE';
  status: 'TRIAL' | 'ACTIVE' | 'SUSPENDED' | 'CANCELLED' | 'OFFBOARDING';
  trialEndsAt: Date | null;
  maxUsers: number;
  maxStorageGb: number;
  isBootstrapped: boolean;
  bootstrappedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ITenantConfig {
  authProvider: 'LOCAL' | 'AZURE_AD' | 'GOOGLE';
  storageProvider: 'S3' | 'MINIO' | 'LOCAL_FILESYSTEM';
  aiProvider: 'ANTHROPIC' | 'AZURE_OPENAI' | 'OPENAI' | 'OLLAMA';
  authConfig: Record<string, unknown> | null;
  storageConfig: Record<string, unknown> | null;
  aiConfig: Record<string, unknown> | null;
}
