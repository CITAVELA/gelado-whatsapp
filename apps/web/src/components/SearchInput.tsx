import { Icon } from './Icon';

export function SearchInput({ value, onChange, placeholder = 'Buscar…', label, autoFocus }: { value: string; onChange: (v: string) => void; placeholder?: string; label?: string; autoFocus?: boolean }) {
  return (
    <div className="search grow">
      <Icon name="search" small />
      <input type="search" value={value} autoFocus={autoFocus} aria-label={label ?? placeholder} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}
