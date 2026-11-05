import { useState } from 'react';

/** Selector sencillo de fecha y hora (hora de Madrid). `onChange` recibe «YYYY-MM-DD» y «HH:mm». */
export function DateTimePicker({ date, time, onChange, min }: { date: string; time: string; onChange: (v: { date: string; time: string }) => void; min?: string }) {
  const [d, setD] = useState(date);
  const [t, setT] = useState(time);
  return (
    <div className="row" style={{ gap: 10 }}>
      <label className="grow">
        <span className="label">Fecha</span>
        <input className="field" type="date" min={min} value={d} onChange={(e) => { setD(e.target.value); onChange({ date: e.target.value, time: t }); }} />
      </label>
      <label style={{ width: 130 }}>
        <span className="label">Hora</span>
        <input className="field" type="time" value={t} onChange={(e) => { setT(e.target.value); onChange({ date: d, time: e.target.value }); }} />
      </label>
    </div>
  );
}
