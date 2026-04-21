-- CreateTable
CREATE TABLE "campaign_top_ups" (
    "id" UUID NOT NULL,
    "campaign_id" UUID NOT NULL,
    "tx_signature" TEXT NOT NULL,
    "amount_usdc" DECIMAL(20,8) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "campaign_top_ups_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "campaign_top_ups_campaign_id_tx_signature_key" ON "campaign_top_ups"("campaign_id", "tx_signature");

-- CreateIndex
CREATE INDEX "campaign_top_ups_campaign_id_idx" ON "campaign_top_ups"("campaign_id");

-- AddForeignKey
ALTER TABLE "campaign_top_ups" ADD CONSTRAINT "campaign_top_ups_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;
