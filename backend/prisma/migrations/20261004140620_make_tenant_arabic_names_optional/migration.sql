-- AlterTable
ALTER TABLE "Committee" ALTER COLUMN "nameAr" DROP NOT NULL;

-- AlterTable
ALTER TABLE "LookupValue" ALTER COLUMN "labelAr" DROP NOT NULL;

-- AlterTable
ALTER TABLE "Role" ALTER COLUMN "nameAr" DROP NOT NULL;

-- AlterTable
ALTER TABLE "WorkflowStage" ALTER COLUMN "nameAr" DROP NOT NULL;

-- AlterTable
ALTER TABLE "WorkflowTemplate" ALTER COLUMN "nameAr" DROP NOT NULL;

-- AlterTable
ALTER TABLE "WorkflowTransition" ALTER COLUMN "labelAr" DROP NOT NULL;
