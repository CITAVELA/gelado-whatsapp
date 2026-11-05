/** Motivo (en español) por el que el estado del número obliga a parar los envíos, o null si no. */
export function phoneStopReason(qualityRating: string | null | undefined, phoneStatus: string | null | undefined): string | null {
  if ((qualityRating ?? '').toUpperCase() === 'RED') return 'la calidad del número ha bajado a rojo';
  const st = (phoneStatus ?? '').toUpperCase();
  if (st === 'FLAGGED') return 'Meta ha marcado el número (FLAGGED)';
  if (st === 'RESTRICTED') return 'el número está restringido por Meta';
  return null;
}
