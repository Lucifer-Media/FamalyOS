'use client';

import { useState, useEffect, useRef } from 'react';
import { Search, X, Loader2, ExternalLink } from 'lucide-react';
import { useRouter } from 'next/navigation';

interface EntityOption {
  id: string;
  title: string;
  type: string;
  subtitle?: string;
}

interface EntityLinkSelectProps {
  value?: string;
  onChange: (id: string | null) => void;
  entityType: string; // Тип сущности для поиска (person, organization, property...)
  placeholder?: string;
  label?: string;
  disabled?: boolean;
  allowClear?: boolean;
  onEntityCreated?: (newId: string) => void;
}

export default function EntityLinkSelect({
  value,
  onChange,
  entityType,
  placeholder = 'Начните ввод для поиска...',
  label,
  disabled = false,
  allowClear = true,
}: EntityLinkSelectProps) {
  const [query, setQuery] = useState('');
  const [options, setOptions] = useState<EntityOption[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const [selectedLabel, setSelectedLabel] = useState<string>('');
  
  const wrapperRef = useRef<HTMLDivElement>(null);
  const router = useRouter();

  // Загрузка названия выбранной сущности при монтировании или изменении value
  useEffect(() => {
    if (value) {
      fetchEntityDetails(value);
    } else {
      setSelectedLabel('');
    }
  }, [value]);

  const fetchEntityDetails = async (id: string) => {
    try {
      const res = await fetch(`/api/entities/${id}`);
      if (res.ok) {
        const data = await res.json();
        setSelectedLabel(data.title || `ID: ${id}`);
      }
    } catch (e) {
      console.error('Failed to fetch entity details', e);
    }
  };

  // Поиск сущностей
  useEffect(() => {
    const delayDebounce = setTimeout(async () => {
      if (query.length < 2) {
        setOptions([]);
        return;
      }

      setIsLoading(true);
      try {
        // Используем глобальный поиск API с фильтром по типу
        const params = new URLSearchParams({
          q: query,
          types: entityType, // Фильтр по конкретному типу
          limit: '10',
        });

        const res = await fetch(`/api/search?${params}`);
        if (res.ok) {
          const data = await res.json();
          setOptions(data.results || []);
        }
      } catch (error) {
        console.error('Search error:', error);
        setOptions([]);
      } finally {
        setIsLoading(false);
      }
    }, 300);

    return () => clearTimeout(delayDebounce);
  }, [query, entityType]);

  // Закрытие при клике вне
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleSelect = (option: EntityOption) => {
    onChange(option.id);
    setSelectedLabel(option.title);
    setQuery('');
    setIsOpen(false);
  };

  const handleClear = (e: React.MouseEvent) => {
    e.stopPropagation();
    onChange(null);
    setSelectedLabel('');
    setQuery('');
  };

  const handleNavigate = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    router.push(`/entities/${id}`);
    setIsOpen(false);
  };

  return (
    <div className="w-full" ref={wrapperRef}>
      {label && (
        <label className="block text-sm font-medium text-gray-700 mb-1">
          {label}
        </label>
      )}
      
      <div className="relative">
        <div className="relative">
          <input
            type="text"
            className={`w-full pl-10 pr-10 py-2 border rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-colors ${
              disabled ? 'bg-gray-100 cursor-not-allowed' : 'bg-white'
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
          
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-gray-400" />
          
          {value && allowClear && !disabled && (
            <button
              type="button"
              onClick={handleClear}
              className="absolute right-7 top-2.5 text-gray-400 hover:text-gray-600"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>

        {/* Выпадающий список */}
        {isOpen && query.length >= 2 && (
          <div className="absolute z-50 w-full mt-1 bg-white border border-gray-200 rounded-md shadow-lg max-h-60 overflow-auto">
            {isLoading ? (
              <div className="p-3 text-center text-gray-500 flex items-center justify-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin" />
                Поиск...
              </div>
            ) : options.length > 0 ? (
              <ul className="py-1">
                {options.map((option) => (
                  <li
                    key={option.id}
                    className="px-4 py-2 hover:bg-blue-50 cursor-pointer group flex justify-between items-center"
                    onClick={() => handleSelect(option)}
                  >
                    <div className="flex flex-col">
                      <span className="font-medium text-gray-900">{option.title}</span>
                      {option.subtitle && (
                        <span className="text-xs text-gray-500">{option.subtitle}</span>
                      )}
                      <span className="text-xs text-blue-600 uppercase tracking-wider mt-0.5">
                        {option.type}
                      </span>
                    </div>
                    
                    <button
                      onClick={(e) => handleNavigate(e, option.id)}
                      className="opacity-0 group-hover:opacity-100 p-1 hover:bg-blue-100 rounded text-blue-600 transition-opacity"
                      title="Открыть карточку"
                    >
                      <ExternalLink className="h-3 w-3" />
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="p-3 text-center text-gray-500 text-sm">
                Ничего не найдено. <br/>
                <span className="text-xs text-gray-400">Попробуйте другой запрос или создайте новую сущность.</span>
              </div>
            )}
          </div>
        )}
      </div>
      
      {value && !query && (
        <div className="mt-1 text-xs text-green-600 flex items-center gap-1">
          <span className="w-2 h-2 bg-green-500 rounded-full"></span>
          Сущность выбрана
        </div>
      )}
    </div>
  );
}
