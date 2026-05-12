-- VidU marketing site: waitlist table only (fresh database).

CREATE TYPE "WaitlistRole" AS ENUM ('brand', 'creator');

CREATE TABLE "waitlist" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "email" TEXT NOT NULL,
    "role" "WaitlistRole" NOT NULL,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "waitlist_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "waitlist_email_key" ON "waitlist"("email");
