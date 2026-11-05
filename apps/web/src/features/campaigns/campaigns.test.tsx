import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CampaignStatusPill, pct1, pctOf, statusLabel } from './status';
import { previewValues, variableLabel } from './CampaignWizard';

describe('Campañas · estado y formato', () => {
  it('«Enviando · x %» cuenta enviados y fallidos sobre el total', () => {
    expect(statusLabel({ status: 'RUNNING', sentCount: 40, failedCount: 2, totalRecipients: 100 })).toBe('Enviando · 42 %');
    expect(statusLabel({ status: 'DRAFT', sentCount: 0, failedCount: 0, totalRecipients: 0 })).toBe('Borrador');
    expect(statusLabel({ status: 'SCHEDULED', sentCount: 0, failedCount: 0, totalRecipients: 5 })).toBe('Programada');
    expect(statusLabel({ status: 'COMPLETED', sentCount: 5, failedCount: 0, totalRecipients: 5 })).toBe('Completada');
  });

  it('pinta la píldora con la clase del estado', () => {
    render(<CampaignStatusPill c={{ status: 'PAUSED', sentCount: 0, failedCount: 0, totalRecipients: 3 }} />);
    expect(screen.getByText('Pausada').className).toContain('p-warn');
  });

  it('porcentajes sin dividir por cero', () => {
    expect(pctOf(1238, 1489)).toBe(83);
    expect(pctOf(1, 0)).toBe(0);
    expect(pct1(7, 1489)).toBe('0,5 %');
  });
});

describe('Campañas · variables', () => {
  it('etiqueta cada variable y genera valores de ejemplo para la vista previa', () => {
    expect(variableLabel('body.1')).toBe('Variable {{1}} del mensaje');
    expect(variableLabel('button.0')).toMatch(/botón/);
    expect(previewValues({ 'body.1': { field: 'firstName', fallback: 'cliente' }, 'body.2': { text: 'tintes' }, 'body.3': { field: 'company', fallback: '' } })).toEqual({
      'body.1': 'Juan',
      'body.2': 'tintes',
      'body.3': 'Peluquería Marisol',
    });
  });
});
