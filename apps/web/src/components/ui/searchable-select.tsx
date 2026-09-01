'use client';

import { useEffect, useRef, useState } from 'react';
import { Search, ChevronDown } from 'lucide-react';

interface SearchableSelectOption {
  value: string;
  label: string;
}

interface SearchableSelectProps {
  value: string;
  onChange: (value: string) => void;
  options: SearchableSelectOption[];
  placeholder?: string;
  disabled?: boolean;
}

/**
 * Замена обычного <select> для длинных списков (типов документов у нас
 * уже больше 40) — обычный select требует пролистывания и не даёт искать
 * по названию.
 */
export function SearchableSelect({ value, onChange, options, placeholder = '— выберите —', disabled }: SearchableSelectProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState('');
  const wrapperRef = useRef<HTMLDivElement>(null);

  const selected = options.find((o) => o.value === value);
  const filtered = query
    ? options.filter((o) => o.label.toLowerCase().includes(query.toLowerCase()))
    : options;

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setIsOpen(false);
        setQuery('');
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  return (
    <div className="relative" ref={wrapperRef}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setIsOpen((v) => !v)}
        className="flex w-full items-center justify-between rounded-card border border-line bg-white px-3 py-2 text-left text-sm disabled:bg-paper-dim"
      >
        <span className={selected ? 'text-ink' : 'text-ink/40'}>{selected ? selected.label : placeholder}</span>
        <ChevronDown size={16} className="text-ink/30" />
      </button>

      {isOpen && !disabled && (
        <div className="animate-in absolute z-50 mt-1 w-full origin-top overflow-hidden rounded-card border border-line bg-white shadow-md">
          <div className="relative border-b border-line">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-ink/30" />
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Начните вводить для поиска…"
              className="w-full py-2 pl-10 pr-3 text-sm outline-none"
            />
          </div>
          <div className="max-h-64 overflow-y-auto">
            <button
              type="button"
              onClick={() => {
                onChange('');
                setIsOpen(false);
                setQuery('');
              }}
              className="block w-full px-3 py-2 text-left text-sm text-ink/40 hover:bg-paper-dim"
            >
              {placeholder}
            </button>
            {filtered.map((o) => (
              <button
                key={o.value}
                type="button"
                onClick={() => {
                  onChange(o.value);
                  setIsOpen(false);
                  setQuery('');
                }}
                className={`block w-full px-3 py-2 text-left text-sm hover:bg-paper-dim ${
                  o.value === value ? 'bg-paper-dim font-medium' : ''
                }`}
              >
                {o.label}
              </button>
            ))}
            {filtered.length === 0 && <p className="px-3 py-2 text-sm text-ink/40">Ничего не найдено</p>}
          </div>
        </div>
      )}
    </div>
  );
}
