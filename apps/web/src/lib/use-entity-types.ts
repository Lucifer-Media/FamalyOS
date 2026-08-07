'use client';

import { useEffect, useState } from 'react';
import { apiFetch } from './api';
import { EntityTypeSchema } from './entity-type-schemas';

export function useEntityTypeList() {
  const [schemas, setSchemas] = useState<EntityTypeSchema[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiFetch<EntityTypeSchema[]>('/entity-types')
      .then(setSchemas)
      .finally(() => setLoading(false));
  }, []);

  return { schemas, loading };
}

export function useEntityTypeSchema(entityType: string | null) {
  const [schema, setSchema] = useState<EntityTypeSchema | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!entityType) {
      setLoading(false);
      return;
    }
    setLoading(true);
    apiFetch<EntityTypeSchema | null>(`/entity-types/${entityType}`)
      .then(setSchema)
      .finally(() => setLoading(false));
  }, [entityType]);

  return { schema, loading };
}
