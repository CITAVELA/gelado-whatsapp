import { Injectable } from '@nestjs/common';
import { Marked, type Tokens } from 'marked';
import sanitizeHtml from 'sanitize-html';
import { SettingsService } from './settings.service';

/** Quita tildes y símbolos: «Cómo solicitar la supresión» → «como-solicitar-la-supresion». */
export function slugify(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const SANITIZE: sanitizeHtml.IOptions = {
  allowedTags: ['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'a', 'ul', 'ol', 'li', 'strong', 'em', 'b', 'i', 'br', 'hr', 'blockquote', 'code', 'pre', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'del'],
  allowedAttributes: { a: ['href', 'title', 'target', 'rel'], h1: ['id'], h2: ['id'], h3: ['id'], h4: ['id'], h5: ['id'], h6: ['id'], th: ['align'], td: ['align'] },
  allowedSchemes: ['http', 'https', 'mailto', 'tel'],
  allowedSchemesAppliedToAttributes: ['href'],
  allowProtocolRelative: false,
  transformTags: {
    a: (tag, attribs) => {
      const external = /^https?:/i.test(attribs.href ?? '');
      return { tagName: 'a', attribs: { ...attribs, ...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {}) } };
    },
  },
};

/** Política de privacidad pública (RF-7.6): Markdown → HTML saneado → página completa sin JavaScript. */
@Injectable()
export class PrivacyService {
  constructor(private readonly settings: SettingsService) {}

  /** Markdown → HTML saneado con ids de ancla sin tildes. Los títulos «Título {#id}» fijan el id. */
  renderMarkdown(markdown: string): string {
    const used = new Set<string>();
    const explicit = new Map<string, string>(); // texto del título → id
    const source = markdown.replace(/^(#{1,6}[ \t]+.*?)[ \t]*\{#([A-Za-z0-9_-]+)\}[ \t]*$/gm, (_m, head: string, id: string) => {
      explicit.set(head.replace(/^#{1,6}[ \t]+/, '').trim(), id);
      return head;
    });
    // Los ids explícitos se reservan antes para que un título «normal» no los ocupe
    for (const id of explicit.values()) used.add(id.toLowerCase());
    const md = new Marked({ gfm: true, breaks: false });
    md.use({
      renderer: {
        heading(this: any, token: Tokens.Heading) {
          const inner = this.parser.parseInline(token.tokens);
          let id = explicit.get(token.text.trim()) ?? '';
          if (!id) {
            const base = slugify(token.text) || 'seccion';
            id = base;
            // La sección de supresión de datos lleva siempre el ancla «supresion» (Meta la enlaza)
            if (base.includes('supresion') && !used.has('supresion')) id = 'supresion';
            let n = 2;
            while (used.has(id)) id = `${base}-${n++}`;
            used.add(id);
          }
          return `<h${token.depth} id="${esc(id)}">${inner}</h${token.depth}>\n`;
        },
      },
    });
    const html = md.parse(source, { async: false }) as string;
    return sanitizeHtml(html, SANITIZE);
  }

  /** Página HTML completa (sin scripts; estilos en línea, permitidos por la CSP). */
  renderPage(markdown: string, updatedAt: string | Date | null): string {
    const body = markdown.trim() ? this.renderMarkdown(markdown) : '<p>Esta página se está preparando. Vuelve a consultarla en breve.</p>';
    const d = updatedAt ? new Date(updatedAt) : null;
    const updated = d && d.getTime() > 86400_000 ? new Intl.DateTimeFormat('es-ES', { timeZone: 'Europe/Madrid', day: 'numeric', month: 'long', year: 'numeric' }).format(d) : null;
    return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Política de privacidad · Exclusivas Gelado</title>
<meta name="description" content="Política de privacidad de Exclusivas Gelado: qué datos tratamos, para qué, cómo darte de baja y cómo pedir la supresión de tus datos.">
<style>
:root{--bg:#faf8f5;--fg:#1f1b16;--muted:#6b6258;--line:#e4ddd3;--accent:#8a5a2b;--card:#fff}
@media (prefers-color-scheme: dark){:root{--bg:#171411;--fg:#ece6dd;--muted:#a69b8d;--line:#2f2a24;--accent:#d9a066;--card:#1f1b17}}
*{box-sizing:border-box}
html{scroll-behavior:smooth}
body{margin:0;background:var(--bg);color:var(--fg);font:18px/1.7 Georgia,'Iowan Old Style','Times New Roman',serif;-webkit-text-size-adjust:100%}
header{border-bottom:1px solid var(--line);background:var(--card)}
.wrap{max-width:46rem;margin:0 auto;padding:0 20px}
.logo{display:inline-block;padding:18px 0;font:700 22px/1 system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;letter-spacing:.32em;color:var(--fg);text-decoration:none}
.logo span{color:var(--accent)}
main{padding:32px 0 56px}
h1,h2,h3,h4{font-family:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;line-height:1.25;scroll-margin-top:16px}
h1{font-size:2rem;margin:.2em 0 .3em}
h2{font-size:1.3rem;margin:2em 0 .5em;padding-top:.6em;border-top:1px solid var(--line)}
h3{font-size:1.1rem;margin:1.5em 0 .4em}
p,li{overflow-wrap:anywhere}
a{color:var(--accent);text-underline-offset:2px}
.updated{color:var(--muted);font:14px system-ui,sans-serif;margin:0 0 1.5em}
table{border-collapse:collapse;width:100%;font:15px/1.5 system-ui,sans-serif;display:block;overflow-x:auto}
th,td{border:1px solid var(--line);padding:8px 10px;text-align:left;vertical-align:top}
th{background:var(--card)}
blockquote{margin:1em 0;padding:.2em 1em;border-left:3px solid var(--accent);color:var(--muted)}
code{font-size:.9em;background:var(--card);padding:.1em .35em;border-radius:4px}
hr{border:0;border-top:1px solid var(--line);margin:2em 0}
footer{border-top:1px solid var(--line);color:var(--muted);font:14px system-ui,sans-serif;padding:20px 0}
@media (max-width:520px){body{font-size:17px}h1{font-size:1.6rem}}
</style>
</head>
<body>
<header><div class="wrap"><a class="logo" href="/privacidad" aria-label="Exclusivas Gelado">GEL<span>A</span>DO</a></div></header>
<main><div class="wrap">
${updated ? `<p class="updated">Última actualización: ${esc(updated)}</p>` : ''}
${body}
</div></main>
<footer><div class="wrap">Exclusivas Gelado · Política de privacidad</div></footer>
</body>
</html>
`;
  }

  async publicPage() {
    const p = await this.settings.get('privacy_policy');
    return this.renderPage(p.markdown, p.updatedAt);
  }
}
