-- AlterTable
ALTER TABLE "business_profiles" ADD COLUMN     "discountPolicy" JSONB NOT NULL DEFAULT '{"cashierCanApply":false,"cashierCanRequest":false,"supervisorCanApply":false,"managerCanApply":true,"approvalRequired":true,"discountLimits":{}}';
