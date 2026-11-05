// Formato de texto de WhatsApp: *negrita*, _cursiva_, ~tachado~, `código` y enlaces. React escapa todo el texto.
import { Fragment, type ReactNode } from 'react';

const MARKS: Record<string, 'strong' | 'em' | 's' | 'code'> = { '*': 'strong', _: 'em', '~': 's', '`': 'code' };
// marca de apertura al inicio o tras espacio/puntuación; cierre antes de espacio/puntuación/fin
const FMT = /(^|[\s(¿¡>])([*_~`])(?=\S)([^\n]*?\S|\S)\2(?=$|[\s.,;:!?)\]])/;
const URL_RE = /https?:\/\/[^\s<]+[^\s<.,;:!?)\]]/;

export function renderWhatsApp(text: string, keyPrefix = 'w'): ReactNode[] {
  const out: ReactNode[] = [];
  let rest = text;
  let i = 0;
  while (rest) {
    const f = FMT.exec(rest);
    const u = URL_RE.exec(rest);
    const fIdx = f ? f.index + f[1]!.length : Infinity;
    const uIdx = u ? u.index : Infinity;
    if (!f && !u) {
      out.push(rest);
      break;
    }
    if (uIdx <= fIdx && u) {
      if (u.index > 0) out.push(rest.slice(0, u.index));
      out.push(
        <a key={`${keyPrefix}-${i++}`} href={u[0]} target="_blank" rel="noopener noreferrer">{u[0]}</a>,
      );
      rest = rest.slice(u.index + u[0].length);
      continue;
    }
    const m = f!;
    const start = m.index + m[1]!.length;
    if (start > 0) out.push(rest.slice(0, start));
    const tag = MARKS[m[2]!]!;
    const inner = m[3]!;
    const key = `${keyPrefix}-${i++}`;
    const content = tag === 'code' ? inner : renderWhatsApp(inner, key);
    const El = tag;
    out.push(<El key={key}>{content}</El>);
    rest = rest.slice(m.index + m[0].length);
  }
  return out.map((n, k) => (typeof n === 'string' ? <Fragment key={`${keyPrefix}-t${k}`}>{n}</Fragment> : n));
}

export function WhatsAppText({ text }: { text: string }) {
  return <span className="wa-text">{renderWhatsApp(text)}</span>;
}
