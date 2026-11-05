-- CreateTable
CREATE TABLE "SuppressedPhone" (
    "phoneHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SuppressedPhone_pkey" PRIMARY KEY ("phoneHash")
);

-- RLS sin políticas, como el resto de tablas (docs/04): la Data API de Supabase no puede leerla.
ALTER TABLE "SuppressedPhone" ENABLE ROW LEVEL SECURITY;
