'use client';

import { useState, useEffect, useRef } from 'react';
import { Search, X, Loader2, ExternalLink } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { apiFetch } from '@/lib/api';

interface EntityOption {
  id: string;
  entityType: string;
  title: string;
  snippet?: string;
}

interface EntityLinkSelectProps {
  value?: string;
  onChange: (id: string | null) => void;
  entityType: string;
  placeholder?: string;
  label?: string;
  disabled?: boolean;
  allowClear?: boolean;
}

function routeForEntity(id: string, entityType: string): string {
  if (entityType === 'passport_rf') return `/documents/passport-rf/${id}`;
  return `/documents/${entityType}/${id}`;
}

/**
 * Выбор связи между сущностями через поиск — заменяет прямой ввод ID
 * текстом для всех полей типа 'link' в динамической форме.
 */
export default function EntityLinkSelect({
  value,
  onChange,
  entityType,
  placeholder = 'Начните ввод для поиска…',
  label,
  disabled = false,
  allowClear = true,
}: EntityLinkSelectProps) {
  const [query, setQuery] = useState('');
  const [options, setOptions] = useState<EntityOption[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const [selectedLabel, setSelectedLabel] = useState('');
  const wrapperRef = useRef<HTMLDivElement>(null);
  const router = useRouter();

  useEffect(() => {
    if (!value) {
      setSelectedLabel('');
      return;
    }
    apiFetch<{ title: string }>(`/entities/${value}`)
      .then((data) => setSelectedLabel(data.title || `ID: ${value}`))
      .catch(() => setSelectedLabel(`ID: ${value}`));
  }, [value]);

  useEffect(() => {
    const delay = setTimeout(async () => {
      if (query.length < 2) {
        setOptions([]);
        return;
      }
      setIsLoading(true);
      try {
        const results = await apiFetch<EntityOption[]>(
          `/search?q=${encodeURIComponent(query)}&types=${encodeURIComponent(entityType)}`,
        );
        setOptions(results.slice(0, 10));
      } catch {
        setOptions([]);
      } finally {
        setIsLoading(false);
      }
    }, 300);
    return () => clearTimeout(delay);
  }, [query, entityType]);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  function handleSelect(option: EntityOption) {
    onChange(option.id);
    setSelectedLabel(option.title);
    setQuery('');
    setIsOpen(false);
  }

  function handleClear(e: React.MouseEvent) {
    e.stopPropagation();
    onChange(null);
    setSelectedLabel('');
    setQuery('');
  }

  function handleNavigate(e: React.MouseEvent, option: EntityOption) {
    e.stopPropagation();
    router.push(routeForEntity(option.id, option.entityType));
    setIsOpen(false);
  }

  return (
    <div className="w-full" ref={wrapperRef}>
      {label && <label className="mb-1 block text-sm font-medium text-ink/70">{label}</label>}

      <div className="relative">
        <div className="relative">
          <input
            type="text"
            className={`w-full rounded-card border border-line py-2 pl-10 pr-10 transition-colors focus:border-clay focus:outline-none focus:ring-1 focus:ring-clay ${
              disabled ? 'cursor-not-allowed bg-paper-dim' : 'bg-paper'
            }`}
            placeholder={value ? selectedLabel : placeholder}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setIsOpen(true);
            }}
            onFocus={() => setIsOpen(true)}
            disabled={disabled}
          />
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-ink/30" />
          {value && allowClear && !disabled && (
            <button type="button" onClick={handleClear} className="absolute right-7 top-2.5 text-ink/30 hover:text-ink/60">
              <X className="h-4 w-4" />
            </button>
          )}
        </div>

        {isOpen && query.length >= 2 && (
          <div className="absolute z-50 mt-1 max-h-60 w-full overflow-auto rounded-card border border-line bg-paper shadow-md">
            {isLoading ? (
              <div className="flex items-center justify-center gap-2 p-3 text-sm text-ink/50">
                <Loader2 className="h-4 w-4 animate-spin" /> Поиск…
              </div>
            ) : options.length > 0 ? (
              <ul className="py-1">
                {options.map((option) => (
                  <li
                    key={option.id}
                    className="group flex cursor-pointer items-center justify-between px-4 py-2 hover:bg-paper-dim"
                    onClick={() => handleSelect(option)}
                  >
                    <div className="flex flex-col">
                      <span className="font-medium text-ink">{option.title}</span>
                      {option.snippet && <span className="text-xs text-ink/40">{option.snippet}</span>}
                    </div>
                    <button
                      onClick={(e) => handleNavigate(e, option)}
                      className="rounded p-1 text-clay opacity-0 transition-opacity hover:bg-clay/10 group-hover:opacity-100"
                      title="Открыть карточку"
                    >
                      <ExternalLink className="h-3 w-3" />
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="p-3 text-center text-sm text-ink/50">
                Ничего не найдено.
                <br />
                <span className="text-xs text-ink/30">Попробуйте другой запрос или создайте новую запись.</span>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
