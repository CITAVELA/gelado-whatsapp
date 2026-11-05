// CONTRATO (dueño: S3 · Plantillas). Vista previa tipo WhatsApp de una plantilla, con variables rellenadas.
// La usan el editor (S3), el modal de plantilla del chat (S4) y el asistente de campañas (S6).
import type { TemplateComponent } from '@gelado/shared';
export interface TemplatePreviewProps {
  components: TemplateComponent[];
  /** valores por clave de variable: { "body.1": "Ginés", "header.1": "…" } */
  values?: Record<string, string>;
  /** URL de la cabecera multimedia (imagen/vídeo/documento) si la hay */
  headerMediaUrl?: string | null;
}
export function TemplatePreview({ components }: TemplatePreviewProps) {
  const body = components.find((c) => c.type === 'BODY')?.text ?? '';
  return (
    <div className="wa-prev">
      <div className="wa-bub">{body}</div>
    </div>
  );
}
