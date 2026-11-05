// Submenús: con ratón o teclado se pliegan al volver a pulsar; con un toque (que dispara mouseenter y luego click) no se cierran.
import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MenuItem, Popover, SubMenu } from './Popover';

function setup() {
  render(
    <Popover trigger={<button>Abrir</button>}>
      {() => (
        <>
          <MenuItem>Marcar</MenuItem>
          <SubMenu label="Asignar">{() => <MenuItem>Cristina</MenuItem>}</SubMenu>
        </>
      )}
    </Popover>,
  );
  fireEvent.click(screen.getByText('Abrir'));
  return screen.getByRole('menuitem', { name: /^Asignar/ });
}
const expanded = (el: HTMLElement) => el.getAttribute('aria-expanded');

describe('SubMenu', () => {
  it('teclado o ratón: pulsar abre y volver a pulsar pliega', () => {
    const sub = setup();
    expect(expanded(sub)).toBe('false');
    fireEvent.click(sub);
    expect(expanded(sub)).toBe('true');
    expect(screen.getByRole('menuitem', { name: 'Cristina' })).toBeInTheDocument();
    fireEvent.click(sub);
    expect(expanded(sub)).toBe('false');
    expect(screen.queryByRole('menuitem', { name: 'Cristina' })).toBeNull();
  });

  it('toque: mouseenter abre y el click siguiente no lo cierra; un segundo toque tampoco', () => {
    const sub = setup();
    fireEvent.mouseEnter(sub.parentElement!);
    expect(expanded(sub)).toBe('true');
    fireEvent.click(sub);
    expect(expanded(sub)).toBe('true');
  });

  it('un click con pointerType touch nunca pliega', () => {
    const sub = setup();
    fireEvent.click(sub);
    expect(expanded(sub)).toBe('true');
    const ev = new MouseEvent('click', { bubbles: true });
    Object.defineProperty(ev, 'pointerType', { value: 'touch' });
    sub.dispatchEvent(ev);
    expect(expanded(sub)).toBe('true');
  });

  it('los elementos del submenú no lo cierran al pasar el puntero; los del menú principal sí', () => {
    const sub = setup();
    fireEvent.click(sub);
    fireEvent.mouseEnter(screen.getByRole('menuitem', { name: 'Cristina' }));
    expect(expanded(sub)).toBe('true');
    fireEvent.mouseEnter(screen.getByRole('menuitem', { name: 'Marcar' }));
    expect(expanded(sub)).toBe('false');
  });
});
