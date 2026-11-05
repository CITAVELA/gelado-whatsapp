-- Borrador local de plantilla («Guardar borrador»): contenido del editor tal cual se guardó (solo en LOCAL_DRAFT)
ALTER TABLE "Template" ADD COLUMN "draftData" JSONB;
