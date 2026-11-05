import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { TemplateEditor } from './TemplateEditor';

const setup = () => render(<MemoryRouter><TemplateEditor /></MemoryRouter>);

describe('TemplateEditor', () => {
  it('genera el nombre de Meta sin tildes y en minúsculas', () => {
    setup();
    fireEvent.change(screen.getByLabelText('Nombre de la plantilla'), { target: { value: 'Campaña Ragnar Z-TECH' } });
    expect(screen.getByLabelText('Nombre en Meta')).toHaveValue('campana_ragnar_z_tech');
  });

  it('en Marketing el botón «No recibir más» es obligatorio y la casilla está bloqueada', () => {
    setup();
    expect(screen.getByRole('checkbox')).toBeChecked();
    expect(screen.getByRole('checkbox')).toBeDisabled();
    expect(screen.getAllByText(/obligatorio/).length).toBeGreaterThan(0);
    fireEvent.change(screen.getByLabelText('Categoría'), { target: { value: 'UTILITY' } });
    expect(screen.getByRole('checkbox')).toBeEnabled();
  });

  it('pide ejemplo de cada variable y la vista previa los usa', () => {
    setup();
    fireEvent.change(screen.getByLabelText('Mensaje'), { target: { value: 'Hola {{1}}, nos vemos' } });
    fireEvent.change(screen.getByLabelText('Ejemplo de la variable 1'), { target: { value: 'Juan' } });
    expect(screen.getByTestId('template-preview')).toHaveTextContent('Hola Juan, nos vemos');
    expect(screen.getByTestId('template-preview')).toHaveTextContent('No recibir más');
  });

  it('muestra errores en español al enviar incompleto', async () => {
    setup();
    fireEvent.click(screen.getByText('Enviar a revisión de Meta'));
    expect(await screen.findByRole('alert')).toHaveTextContent(/nombre|mensaje/i);
  });
});
