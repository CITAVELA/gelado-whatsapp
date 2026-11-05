import { Injectable } from '@nestjs/common';

/** Reloj inyectable: en pruebas se fija o se adelanta para simular el paso de los días. */
@Injectable()
export class CampaignClock {
  private fixed: Date | null = null;
  now(): Date {
    return this.fixed ? new Date(this.fixed) : new Date();
  }
  /** Fija «ahora» (null = reloj real). */
  set(d: Date | null) {
    this.fixed = d;
  }
  /** Adelanta el reloj (parte de la hora actual si estaba libre). */
  advance(ms: number) {
    this.fixed = new Date(this.now().getTime() + ms);
  }
}
