// CONTRATO (dueño: S2 · Contactos). Panel lateral de ficha editable que usa la bandeja (RF-2.21).
// La bandeja (S4) lo importa tal cual; S2 sustituye la implementación sin cambiar las props.
export interface ContactSidePanelProps {
  contactId: string;
  onClose?: () => void;
}
export function ContactSidePanel({ contactId, onClose }: ContactSidePanelProps) {
  return (
    <aside className="info" aria-label="Ficha del contacto">
      <div className="row"><h3 className="grow">Ficha</h3>{onClose && <button className="tbtn" onClick={onClose} aria-label="Cerrar ficha">×</button>}</div>
      <div className="hint">Contacto {contactId}</div>
    </aside>
  );
}
