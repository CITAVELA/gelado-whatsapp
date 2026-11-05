import type { Rates } from './settings';

export type PricingCategory = 'marketing' | 'utility' | 'authentication' | 'service' | 'marketing_lite' | 'authentication_international' | string;

/** Tarifa unitaria para una categoría de `pricing.category` de Meta. */
export function rateFor(category: PricingCategory | null | undefined, rates: Rates): number {
  switch ((category ?? '').toLowerCase()) {
    case 'marketing':
    case 'marketing_lite':
      return rates.marketing;
    case 'utility':
      return rates.utility;
    case 'authentication':
    case 'authentication_international':
      return rates.authentication;
    case 'service':
      return rates.service;
    default:
      return 0;
  }
}

/**
 * Un mensaje solo cuenta para el gasto si Meta lo ha entregado (DELIVERED/READ), es `billable` y trae categoría.
 * Es el único criterio: lo usan el informe de campaña y el gasto del mes de Calidad.
 */
export const COSTABLE_MESSAGE_STATUSES = ['DELIVERED', 'READ'] as const;

export interface BillableMessage {
  pricingCategory: string | null;
  billable: boolean | null;
}

/**
 * Coste estimado de un conjunto de mensajes entregados (docs/06 · Costes):
 * solo cuentan los `billable`; los de servicio son gratis hasta `freeServicePerMonth` al mes.
 * `serviceAlreadyUsed` = mensajes de servicio facturables previos del mismo mes.
 */
export function computeCost(messages: BillableMessage[], rates: Rates, serviceAlreadyUsed = 0) {
  const byCategory: Record<string, { count: number; cost: number }> = {};
  let serviceUsed = serviceAlreadyUsed;
  let total = 0;
  for (const m of messages) {
    if (!m.billable) continue;
    const cat = (m.pricingCategory ?? 'unknown').toLowerCase();
    let unit = rateFor(cat, rates);
    if (cat === 'service') {
      serviceUsed += 1;
      if (serviceUsed <= rates.freeServicePerMonth) unit = 0;
    }
    byCategory[cat] ??= { count: 0, cost: 0 };
    byCategory[cat].count += 1;
    byCategory[cat].cost += unit;
    total += unit;
  }
  return { total: round4(total), byCategory, serviceUsed };
}

/** Coste estimado previo de una campaña: destinatarios × tarifa de la categoría de la plantilla. */
export function estimateCampaignCost(recipients: number, category: 'MARKETING' | 'UTILITY' | 'AUTHENTICATION', rates: Rates): number {
  return round4(recipients * rateFor(category.toLowerCase(), rates));
}

export function round4(n: number) {
  return Math.round(n * 10000) / 10000;
}

export function formatEur(n: number) {
  return new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
}
