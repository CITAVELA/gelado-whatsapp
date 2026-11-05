// Integración F4a + F4b: un número suprimido (derecho de supresión) que vuelve a escribir nace dado de baja.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createWaTestEnv, type WaTestEnv } from './meta-simulator/harness';
import { SuppressionService } from '../src/modules/contacts/suppression.service';

let env: WaTestEnv;
beforeAll(async () => {
  env = await createWaTestEnv();
});
afterAll(async () => env.close());
beforeEach(async () => {
  await env.t.reset();
  env.clear();
});

describe('Lista de supresión en el webhook de entrada', () => {
  it('número suprimido que escribe → contacto REVOKED con nota', async () => {
    await env.t.app.get(SuppressionService).add('+34600999888');
    expect(await env.sim.sendInbound({ from: '34600999888', type: 'text', text: { body: 'Hola otra vez' } })).toBe(200);
    const c = await env.t.prisma.contact.findUniqueOrThrow({ where: { phoneE164: '+34600999888' }, include: { consentEvents: true } });
    expect(c.consentStatus).toBe('REVOKED');
    expect(c.consentEvents.at(-1)?.note).toMatch(/Suprimido previamente/);
  });
  it('número no suprimido sigue UNKNOWN', async () => {
    await env.sim.sendInbound({ from: '34600999777', type: 'text', text: { body: 'Hola' } });
    const c = await env.t.prisma.contact.findUniqueOrThrow({ where: { phoneE164: '+34600999777' } });
    expect(c.consentStatus).toBe('UNKNOWN');
  });
});
