// Notificaciones y sonido (RF-2.20) en navegadores con reglas estrictas: Safari (macOS e iOS) y Firefox.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

const w = window as any;
const saved = { Notification: w.Notification, AudioContext: w.AudioContext, webkitAudioContext: w.webkitAudioContext };
let gesture = false; // true mientras se despacha un gesto del usuario (en Safari solo ahí puede reanudarse el audio)
let created: FakeAudioContext[] = [];
let oscillators = 0;

class FakeAudioContext {
  state: string = 'suspended';
  currentTime = 0;
  destination = {};
  constructor() { created.push(this); }
  resume() { if (gesture) this.state = 'running'; return Promise.resolve(); }
  createOscillator() { oscillators++; return { frequency: { value: 0 }, type: 'sine', connect: (n: any) => n, start() {}, stop() {} }; }
  createGain() { return { gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect: (n: any) => n }; }
}
const gestureEvent = (type: string) => { gesture = true; try { window.dispatchEvent(new Event(type)); } finally { gesture = false; } };

beforeEach(() => { vi.resetModules(); created = []; oscillators = 0; gesture = false; try { localStorage.clear(); } catch { /* */ } });
afterEach(() => {
  w.Notification = saved.Notification; w.AudioContext = saved.AudioContext; w.webkitAudioContext = saved.webkitAudioContext;
  if (saved.Notification === undefined) delete w.Notification;
  if (saved.AudioContext === undefined) delete w.AudioContext;
  if (saved.webkitAudioContext === undefined) delete w.webkitAudioContext;
});

describe('permiso de notificaciones', () => {
  it('con promesa (navegadores modernos)', async () => {
    const requestPermission = vi.fn().mockResolvedValue('granted');
    w.Notification = Object.assign(function () {}, { permission: 'default', requestPermission });
    const { requestNotificationPermission } = await import('./notify');
    expect(await requestNotificationPermission()).toBe('granted');
    expect(requestPermission).toHaveBeenCalledTimes(1);
  });

  it('Safari antiguo: requestPermission(callback) sin promesa', async () => {
    const requestPermission = vi.fn((cb: (p: string) => void) => { setTimeout(() => cb('denied'), 5); });
    w.Notification = Object.assign(function () {}, { permission: 'default', requestPermission });
    const { requestNotificationPermission } = await import('./notify');
    expect(await requestNotificationPermission()).toBe('denied');
    expect(requestPermission).toHaveBeenCalledTimes(1);
    expect(typeof requestPermission.mock.calls[0]![0]).toBe('function');
  });

  it('si requestPermission lanza, devuelve el permiso actual', async () => {
    w.Notification = Object.assign(function () {}, { permission: 'default', requestPermission: () => { throw new Error('x'); } });
    const { requestNotificationPermission } = await import('./notify');
    expect(await requestNotificationPermission()).toBe('default');
  });

  it('iOS Safari normal (sin Notification): «unsupported», sin lanzar', async () => {
    delete w.Notification;
    const { requestNotificationPermission, notificationPermission, notificationsSupported } = await import('./notify');
    expect(notificationsSupported()).toBe(false);
    expect(notificationPermission()).toBe('unsupported');
    expect(await requestNotificationPermission()).toBe('unsupported');
  });

  it('no se pide al cargar: solo tras el clic en el botón', async () => {
    const requestPermission = vi.fn().mockResolvedValue('granted');
    w.Notification = Object.assign(function () {}, { permission: 'default', requestPermission });
    const { NotificationBar } = await import('./NotificationBar');
    const { installAudioUnlock } = await import('./notify');
    const onPerm = vi.fn();
    const off = installAudioUnlock();
    render(<NotificationBar perm="default" onPerm={onPerm} />);
    expect(requestPermission).not.toHaveBeenCalled(); // ni al montar ni con gestos que desbloquean el audio
    gestureEvent('pointerdown');
    expect(requestPermission).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /Activar notificaciones/ }));
    expect(requestPermission).toHaveBeenCalledTimes(1);
    await vi.waitFor(() => expect(onPerm).toHaveBeenCalledWith('granted'));
    off();
  });

  it('sin soporte (iOS): mensaje claro en español en vez de un botón que no hace nada, y se puede cerrar', async () => {
    delete w.Notification;
    const { NotificationBar } = await import('./NotificationBar');
    render(<NotificationBar perm="unsupported" onPerm={() => {}} />);
    expect(screen.queryByRole('button', { name: /Activar notificaciones/ })).toBeNull();
    expect(screen.getByRole('note')).toHaveTextContent(/Safari no permite notificaciones/);
    expect(screen.getByRole('note')).toHaveTextContent(/sonido de aviso/);
    fireEvent.click(screen.getByRole('button', { name: 'Cerrar aviso' }));
    expect(screen.queryByRole('note')).toBeNull();
  });

  it('bloqueadas: explica cómo permitirlas; concedidas: no muestra nada', async () => {
    const { NotificationBar } = await import('./NotificationBar');
    const { rerender, container } = render(<NotificationBar perm="denied" onPerm={() => {}} />);
    expect(screen.getByRole('note')).toHaveTextContent(/bloqueadas/);
    rerender(<NotificationBar perm="granted" onPerm={() => {}} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe('sonido de aviso (WebAudio)', () => {
  it('Safari: sin gesto el contexto está suspendido y no suena; tras el primer toque se desbloquea y suena', async () => {
    w.AudioContext = FakeAudioContext;
    const { installAudioUnlock, playBeep } = await import('./notify');
    const off = installAudioUnlock();
    playBeep(); // llega un mensaje antes de que el usuario haya tocado nada
    await Promise.resolve();
    expect(oscillators).toBe(0);
    gestureEvent('touchend');
    expect(created[0]!.state).toBe('running');
    playBeep();
    expect(oscillators).toBe(2);
    // ya desbloqueado: se desinstalan los oyentes
    created[0]!.state = 'suspended';
    gestureEvent('pointerdown');
    expect(created[0]!.state).toBe('suspended');
    off();
  });

  it.each(['pointerdown', 'touchend', 'keydown', 'click'])('el gesto «%s» desbloquea el audio', async (type) => {
    w.AudioContext = FakeAudioContext;
    const { installAudioUnlock } = await import('./notify');
    const off = installAudioUnlock();
    gestureEvent(type);
    expect(created[0]!.state).toBe('running');
    off();
  });

  it('sigue intentándolo si el primer gesto no basta (p. ej. un pointerdown en iOS) y no crea más de un contexto', async () => {
    w.AudioContext = FakeAudioContext;
    const { installAudioUnlock } = await import('./notify');
    const off = installAudioUnlock();
    window.dispatchEvent(new Event('pointerdown')); // sin gesto válido
    expect(created[0]!.state).toBe('suspended');
    gestureEvent('click');
    expect(created[0]!.state).toBe('running');
    expect(created).toHaveLength(1);
    off();
  });

  it('respaldo con webkitAudioContext', async () => {
    delete w.AudioContext;
    w.webkitAudioContext = FakeAudioContext;
    const { unlockAudio, playBeep } = await import('./notify');
    gesture = true;
    expect(unlockAudio()).toBe(true);
    gesture = false;
    playBeep();
    expect(oscillators).toBe(2);
  });

  it('sin WebAudio no falla', async () => {
    delete w.AudioContext;
    delete w.webkitAudioContext;
    const { unlockAudio, playBeep, installAudioUnlock } = await import('./notify');
    expect(unlockAudio()).toBe(false);
    expect(() => playBeep()).not.toThrow();
    installAudioUnlock()();
  });

  it('showNotification suena aunque no haya permiso ni API de notificaciones (iOS)', async () => {
    w.AudioContext = FakeAudioContext;
    delete w.Notification;
    const { unlockAudio, showNotification } = await import('./notify');
    gesture = true; unlockAudio(); gesture = false;
    expect(() => showNotification('Ana', 'Hola', () => {})).not.toThrow();
    expect(oscillators).toBe(2);
  });
});
