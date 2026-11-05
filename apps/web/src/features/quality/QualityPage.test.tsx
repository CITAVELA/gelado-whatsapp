import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { queryClient } from '../../lib/query';
import { api } from '../../lib/api';
import { QualityPage } from './QualityPage';
import { barClass, fmtRate, monthKey, shiftMonth } from './format';

beforeEach(() => { queryClient.clear(); vi.restoreAllMocks(); });

const status = { qualityRating: 'GREEN', phoneStatus: 'CONNECTED', messagingLimit: 'TIER_2K', dailyLimit: 2000, usedLast24h: 298, displayPhoneNumber: '+34 617 49 82 22', verifiedName: 'Exclusivas Gelado', lastWebhookAt: null, history: [{ qualityRating: 'GREEN', messagingLimit: 'TIER_2K', createdAt: '2026-11-05T10:00:00Z' }] };
const costs = { month: '2026-11', currency: 'EUR', total: 17.43, byCategory: { marketing: { count: 298, cost: 17.43 }, service: { count: 41, cost: 0 } }, byCampaign: [{ campaignId: 'c1', name: 'Tintes KUKIT', count: 298, cost: 17.43 }], freeServiceUsed: 41, freeServiceLimit: 1000 };
const settings = { rates: { currency: 'EUR', marketing: 0.0585, utility: 0.0166, authentication: 0.0166, service: 0.0166, freeServicePerMonth: 1000 } };

function mockApi(campaigns: unknown) {
  vi.spyOn(api, 'get').mockImplementation(async (url: string) => {
    if (url === '/api/quality') return status as any;
    if (url.startsWith('/api/quality/costs')) return costs as any;
    if (url === '/api/settings') return settings as any;
    if (url === '/api/campaigns/analytics') return campaigns as any;
    throw new Error(url);
  });
}
const wrap = () => render(<QueryClientProvider client={queryClient}><MemoryRouter><QualityPage /></MemoryRouter></QueryClientProvider>);

describe('QualityPage', () => {
  it('muestra calidad, límite, uso de 24 h, cupo gratis y gasto por categoría y campaña', async () => {
    mockApi([{ campaignId: 'c1', name: 'Tintes KUKIT', sentAt: '2026-10-20T09:00:00Z', recipients: 300, deliveredPct: 98, readPct: 60, repliedPct: 12, optOutPct: 1 }]);
    wrap();
    expect((await screen.findAllByText('Alta')).length).toBe(2); // semáforo + historial
    expect(screen.getByText('2.000')).toBeInTheDocument();
    expect(screen.getByText(/Usados en las últimas 24 h: 298/)).toBeInTheDocument();
    expect(screen.getByText(/Desde la 1\.001 cuestan 0,0166 €/)).toBeInTheDocument();
    expect((await screen.findAllByText(/17,43/)).length).toBeGreaterThan(0);
    expect(screen.getByText('Marketing (campañas y plantillas)')).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: 'Tintes KUKIT' }).length).toBe(2);
    expect(screen.getByText('98 %')).toBeInTheDocument();
  });

  it('sin campañas muestra «Sin campañas todavía»', async () => {
    mockApi([]);
    wrap();
    expect(await screen.findByText('Sin campañas todavía')).toBeInTheDocument();
  });
});

describe('format', () => {
  it('meses y tarifas', () => {
    expect(shiftMonth('2026-01', -1)).toBe('2025-12');
    expect(shiftMonth('2026-11', -2)).toBe('2026-09');
    expect(monthKey(new Date('2026-11-05T10:00:00Z'))).toBe('2026-11');
    expect(fmtRate(0.0585)).toMatch(/0,0585/);
    expect(barClass(95)).toBe('bad');
    expect(barClass(75)).toBe('warn');
    expect(barClass(10)).toBe('ok');
  });
});
