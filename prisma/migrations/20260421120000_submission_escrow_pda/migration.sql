-- AlterTable
ALTER TABLE "submissions" ADD COLUMN "submission_escrow_pda" TEXT;

-- CreateIndex
CREATE INDEX "submissions_submission_escrow_pda_idx" ON "submissions"("submission_escrow_pda");
