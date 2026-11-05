/** Límite de intentos de login por IP y por usuario (docs/04). En memoria: un solo proceso. */
export class LoginRateLimiter {
  private hits = new Map<string, number[]>();
  /** máximo de fallos por clave: `u:` (usuario) 8, `ip:` 30 en 15 minutos */
  constructor(private readonly maxUser = 8, private readonly maxIp = 30, private readonly windowMs = 15 * 60 * 1000) {}
  private max(key: string) {
    return key.startsWith('ip:') ? this.maxIp : this.maxUser;
  }

  private recent(key: string, now: number) {
    const arr = (this.hits.get(key) ?? []).filter((t) => now - t < this.windowMs);
    this.hits.set(key, arr);
    return arr;
  }
  isBlocked(keys: string[], now = Date.now()) {
    return keys.some((k) => this.recent(k, now).length >= this.max(k));
  }
  fail(keys: string[], now = Date.now()) {
    for (const k of keys) this.recent(k, now).push(now);
  }
  clear() {
    this.hits.clear();
  }
  reset(keys: string[]) {
    for (const k of keys) this.hits.delete(k);
  }
}
