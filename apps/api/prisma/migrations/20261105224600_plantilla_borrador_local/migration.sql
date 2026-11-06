-- Borrador local de plantilla («Guardar borrador»): contenido del editor tal cual se guardó (solo en LOCAL_DRAFT)
-- y marca de «enviando a Meta» para reservar la fila mientras dura el envío (evita dobles envíos y borrados a medias)
ALTER TABLE "Template" ADD COLUMN "draftData" JSONB;
ALTER TABLE "Template" ADD COLUMN "submittingAt" TIMESTAMP(3);
