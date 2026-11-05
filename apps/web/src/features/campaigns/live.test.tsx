import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';

let progress: () => void = () => undefined;
vi.mock('../../lib/socket', () => ({ useSocketEvent: (_e: string, h: () => void) => void (progress = h) }));
const invalidate = vi.fn();
vi.mock('../../lib/query', () => ({ queryClient: { invalidateQueries: (...a: unknown[]) => invalidate(...a) } }));

import { useCampaignLive } from './queries';

function setVisibility(v: 'visible' | 'hidden') {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => v });
  document.dispatchEvent(new Event('visibilitychange'));
}

beforeEach(() => {
  vi.useFakeTimers();
  invalidate.mockClear();
  setVisibility('visible');
});
afterEach(() => vi.useRealTimers());

describe('F4c #19 · progreso de campañas por socket', () => {
  it('visible: agrupa los avisos en una invalidación por ventana', () => {
    const v = renderHook(() => useCampaignLive());
    act(() => {
      for (let i = 0; i < 200; i++) progress();
      vi.advanceTimersByTime(4100);
    });
    expect(invalidate).toHaveBeenCalledTimes(1);
    v.unmount();
  });

  it('oculta: no invalida; al volver a ser visible lo hace una vez', () => {
    const v = renderHook(() => useCampaignLive());
    setVisibility('hidden');
    act(() => {
      for (let i = 0; i < 200; i++) progress();
      vi.advanceTimersByTime(60_000);
    });
    expect(invalidate).not.toHaveBeenCalled();
    act(() => setVisibility('visible'));
    expect(invalidate).toHaveBeenCalledTimes(1);
    v.unmount();
  });
});
