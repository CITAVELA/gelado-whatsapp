-- AlterTable
ALTER TABLE "CampaignRecipient" ALTER COLUMN "phoneE164" DROP NOT NULL;

-- AlterTable
ALTER TABLE "Contact" ALTER COLUMN "phoneE164" DROP NOT NULL;

-- S12 · P16: un contacto sin teléfono («Sin WhatsApp») debe tener al menos correo o código
ALTER TABLE "Contact" ADD CONSTRAINT "Contact_identity_check"
  CHECK ("phoneE164" IS NOT NULL OR "email" IS NOT NULL OR "customerCode" IS NOT NULL);

-- Deduplicación de la importación por correo (sin distinguir mayúsculas)
CREATE INDEX "Contact_email_lower_idx" ON "Contact" (lower("email")) WHERE "email" IS NOT NULL;
