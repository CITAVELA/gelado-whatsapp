-- CreateEnum
CREATE TYPE "MessageSendState" AS ENUM ('SENDING', 'UNCERTAIN');

-- AlterTable
ALTER TABLE "Message" ADD COLUMN     "errorRetryable" BOOLEAN,
ADD COLUMN     "sendStartedAt" TIMESTAMP(3),
ADD COLUMN     "sendState" "MessageSendState";

-- CreateIndex
CREATE INDEX "Message_status_createdAt_idx" ON "Message"("status", "createdAt");
