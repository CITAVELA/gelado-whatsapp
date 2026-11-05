import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { TemplateComponent } from '@gelado/shared';
import { TemplatePreview, renderWhatsAppFormatting } from './TemplatePreview';

const html = (text: string) => renderToStaticMarkup(<>{renderWhatsAppFormatting(text)}</>);

describe('renderWhatsAppFormatting', () => {
  it('negrita, cursiva, tachado y monoespaciado', () => {
    expect(html('Hola *Ginés*')).toBe('Hola <strong>Ginés</strong>');
    expect(html('_oferta_ y ~antes~')).toBe('<em>oferta</em> y <s>antes</s>');
    expect(html('```código```')).toBe('<code>código</code>');
  });
  it('anida y no formatea marcadores pegados a palabras o con espacios', () => {
    expect(html('*_doble_*')).toBe('<strong><em>doble</em></strong>');
    expect(html('snake_case_name')).toBe('snake_case_name');
    expect(html('2 * 3 * 4')).toBe('2 * 3 * 4');
    expect(html('*sin cerrar')).toBe('*sin cerrar');
  });
  it('escapa HTML (no hay inyección)', () => {
    expect(html('<b>x</b> *a*')).toBe('&lt;b&gt;x&lt;/b&gt; <strong>a</strong>');
  });
});

const comps: TemplateComponent[] = [
  { type: 'HEADER', format: 'TEXT', text: 'Oferta {{1}}' },
  { type: 'BODY', text: 'Hola *{{1}}*, tenemos {{2}} para ti.' },
  { type: 'FOOTER', text: 'Un saludo, Gelado.' },
  { type: 'BUTTONS', buttons: [{ type: 'QUICK_REPLY', text: 'Me interesa' }, { type: 'QUICK_REPLY', text: 'No recibir más' }] },
];

describe('TemplatePreview', () => {
  it('sustituye variables, resalta las que faltan y muestra pie y botones', () => {
    const { container } = render(<TemplatePreview components={comps} values={{ 'body.1': 'Ginés', 'header.1': 'hoy' }} />);
    expect(screen.getByText('Ginés').tagName).toBe('STRONG');
    expect(screen.getByText('Oferta hoy')).toBeInTheDocument();
    const missing = container.querySelector('mark.wa-var');
    expect(missing).toHaveTextContent('{{2}}');
    expect(screen.getByText('Un saludo, Gelado.')).toHaveClass('wa-foot');
    expect(screen.getByText(/Me interesa/)).toHaveClass('wa-btn');
    expect(screen.getByText(/No recibir más/)).toHaveClass('wa-btn');
  });
  it('cabecera de imagen: miniatura si hay URL, marcador si no', () => {
    const c: TemplateComponent[] = [{ type: 'HEADER', format: 'IMAGE' }, { type: 'BODY', text: 'Hola' }];
    const { rerender } = render(<TemplatePreview components={c} headerMediaUrl="http://x/y.png" />);
    expect(screen.getByAltText('Cabecera de la plantilla')).toHaveAttribute('src', 'http://x/y.png');
    rerender(<TemplatePreview components={c} />);
    expect(screen.getByRole('img', { name: 'Imagen de cabecera' })).toBeInTheDocument();
  });
});
