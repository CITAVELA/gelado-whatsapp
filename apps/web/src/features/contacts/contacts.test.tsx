import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { ImportField } from '@gelado/shared';
import { ConsentPill } from '../../components/ui';
import { MappingStep } from './MappingStep';
import { diffForm, toForm } from './ContactFields';
import { readFilters, filtersToApi } from './ContactListPage';
import type { ContactDto } from '@gelado/shared';

describe('chip de consentimiento', () => {
  it('verde con consentimiento, gris sin constancia, rojo dado de baja', () => {
    const { rerender } = render(<ConsentPill status="GRANTED" />);
    expect(screen.getByText('Con consentimiento')).toHaveClass('p-ok');
    rerender(<ConsentPill status="UNKNOWN" />);
    expect(screen.getByText('Sin constancia')).toHaveClass('p-grey');
    rerender(<ConsentPill status="REVOKED" />);
    expect(screen.getByText('Dado de baja')).toHaveClass('p-bad');
  });
});

describe('paso de mapeo del importador', () => {
  const columns = ['Nombre', 'Teléfono', 'Género'];
  const sample = [{ Nombre: 'Marisol', 'Teléfono': '612 34 56 78', 'Género': '' }];
  it('muestra el campo sugerido y un ejemplo por columna, y avisa si falta el teléfono', () => {
    const mapping: Record<string, ImportField> = { Nombre: 'firstName', 'Teléfono': 'ignore', 'Género': 'ignore' };
    render(<MappingStep columns={columns} mapping={mapping} sampleRows={sample} onChange={() => undefined} />);
    expect(screen.getByLabelText('Campo para la columna Nombre')).toHaveValue('firstName');
    expect(screen.getByText('Marisol')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent(/teléfono móvil/);
  });
  it('cambiar un select avisa con la columna y el campo', () => {
    const onChange = vi.fn();
    const mapping: Record<string, ImportField> = { Nombre: 'firstName', 'Teléfono': 'phone', 'Género': 'ignore' };
    render(<MappingStep columns={columns} mapping={mapping} sampleRows={sample} onChange={onChange} />);
    expect(screen.queryByRole('alert')).toBeNull();
    fireEvent.change(screen.getByLabelText('Campo para la columna Género'), { target: { value: 'notes' } });
    expect(onChange).toHaveBeenCalledWith('Género', 'notes');
  });
});

describe('ficha y filtros', () => {
  const c = { firstName: 'Ana', lastName: null, phoneE164: '+34617498222', landline: null, email: 'a@b.es', customerCode: '3990', taxId: null, company: null, notes: null } as unknown as ContactDto;
  it('diffForm envía solo lo que cambia', () => {
    const f = toForm(c);
    expect(diffForm(f, c)).toEqual({});
    expect(diffForm({ ...f, lastName: ' Ruiz ', email: '' }, c)).toEqual({ lastName: 'Ruiz', email: '' });
  });
  it('los filtros viajan en la URL y se traducen a la API', () => {
    const f = readFilters(new URLSearchParams('q=ana&include=a&include=b&consent=REVOKED&invalid=1&page=3'));
    expect(f).toMatchObject({ q: 'ana', include: ['a', 'b'], consent: 'REVOKED', invalid: true, page: 3, sort: 'name' });
    expect(filtersToApi(f)).toMatchObject({ includeLabelIds: ['a', 'b'], consent: 'REVOKED', phoneInvalid: 'true' });
    expect(readFilters(new URLSearchParams('consent=xx')).consent).toBe('');
  });
});
