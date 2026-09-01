'use client';

import { useEffect, useState } from 'react';
import { apiFetch } from '@/lib/api';

export interface PersonOption {
  id: string;
  fullName: string;
}

export function usePeople() {
  const [people, setPeople] = useState<PersonOption[]>([]);
  useEffect(() => {
    apiFetch<PersonOption[]>('/people')
      .then(setPeople)
      .catch(() => setPeople([]));
  }, []);
  return people;
}

export default function PersonSelect({
  value,
  onChange,
  disabled,
  allowEmpty = true,
}: {
  value?: string | null;
  onChange: (id: string | undefined) => void;
  disabled?: boolean;
  allowEmpty?: boolean;
}) {
  const people = usePeople();
  return (
    <select
      value={value ?? ''}
      onChange={(e) => onChange(e.target.value || undefined)}
      disabled={disabled}
      className="w-full rounded-card border border-line bg-paper px-3 py-1.5 text-sm"
    >
      {allowEmpty && <option value="">— не указан —</option>}
      {people.map((p) => (
        <option key={p.id} value={p.id}>
          {p.fullName}
        </option>
      ))}
    </select>
  );
}
