'use client';

import { useEffect, useState } from 'react';
import { AppShell } from '@/components/app-shell';
import { useRequireAuth } from '@/lib/use-require-auth';
import { useEntityTypeSchema } from '@/lib/use-entity-types';
import { DynamicEntityForm } from '@/components/dynamic-entity-form';
import { apiFetch } from '@/lib/api';
import { Button, Card, ErrorText } from '@/components/ui';
import { ChevronRight, Plus } from 'lucide-react';

interface LocationItem {
  id: string;
  title: string;
  attributes: { locationType?: string; address?: string };
}

export default function LocationsPage() {
  const { loading, isAuthenticated } = useRequireAuth();
  const { schema } = useEntityTypeSchema('location');
  const [roots, setRoots] = useState<LocationItem[]>([]);
  const [expanded, setExpanded] = useState<Record<string, LocationItem[]>>({});
  const [creating, setCreating] = useState<string | null>(null); // parentId или 'root'
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [error, setError] = useState('');

  async function loadRoots() {
    const data = await apiFetch<LocationItem[]>('/entities?entityType=location&rootOnly=true');
    setRoots(data);
  }

  useEffect(() => {
    loadRoots().catch((e) => setError(e.message));
  }, []);

  async function toggleExpand(id: string) {
    if (expanded[id]) {
      setExpanded((s) => {
        const next = { ...s };
        delete next[id];
        return next;
      });
      return;
    }
    const children = await apiFetch<LocationItem[]>(`/entities/${id}/children`);
    setExpanded((s) => ({ ...s, [id]: children }));
  }

  async function onCreate(parentId: string | null) {
    if (!schema) return;
    setError('');
    try {
      const title = (values.address as string) || String(values.locationType ?? 'Локация');
      await apiFetch('/entities', {
        method: 'POST',
        body: {
          entityType: 'location',
          title,
          attributes: values,
          parentEntityId: parentId ?? undefined,
        },
      });
      setCreating(null);
      setValues({});
      if (parentId) {
        const children = await apiFetch<LocationItem[]>(`/entities/${parentId}/children`);
        setExpanded((s) => ({ ...s, [parentId]: children }));
      } else {
        await loadRoots();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось создать локацию');
    }
  }

  if (loading || !isAuthenticated) return null;

  return (
    <AppShell>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-2xl font-semibold text-ink">Локации</h1>
          <p className="mt-1 text-sm text-ink/60">Страна → Город → Дом → Квартира → Комната.</p>
        </div>
        <Button onClick={() => setCreating(creating === 'root' ? null : 'root')} disabled={!schema}>
          <Plus size={16} /> Добавить корневую локацию
        </Button>
      </div>

      {!schema && <p className="mt-4 text-sm text-ink/50">Загрузка…</p>}

      {creating === 'root' && schema && (
        <Card className="animate-in mt-4">
          <DynamicEntityForm schema={schema} values={values} onChange={(k, v) => setValues((s) => ({ ...s, [k]: v }))} />
          <div className="mt-3 flex gap-2">
            <Button onClick={() => onCreate(null)}>Сохранить</Button>
            <Button variant="secondary" onClick={() => setCreating(null)}>
              Отмена
            </Button>
          </div>
        </Card>
      )}

      <ErrorText>{error}</ErrorText>

      <div className="mt-6 space-y-2">
        {roots.map((loc) => (
          <LocationNode
            key={loc.id}
            location={loc}
            depth={0}
            expanded={expanded}
            onToggle={toggleExpand}
            creating={creating}
            setCreating={setCreating}
            values={values}
            setValues={setValues}
            schema={schema}
            onCreate={onCreate}
          />
        ))}
        {roots.length === 0 && <p className="text-sm text-ink/50">Локаций пока нет.</p>}
      </div>
    </AppShell>
  );
}

function LocationNode({
  location,
  depth,
  expanded,
  onToggle,
  creating,
  setCreating,
  values,
  setValues,
  schema,
  onCreate,
}: any) {
  const children = expanded[location.id];
  return (
    <div style={{ marginLeft: depth * 20 }}>
      <Card className="flex items-center justify-between">
        <button onClick={() => onToggle(location.id)} className="flex items-center gap-2 text-left">
          <ChevronRight size={14} className={expanded[location.id] ? 'rotate-90' : ''} />
          <span className="font-medium text-ink">{location.title}</span>
          {location.attributes?.locationType && (
            <span className="text-xs text-ink/40">{location.attributes.locationType}</span>
          )}
        </button>
        <Button
          variant="secondary"
          onClick={() => setCreating(creating === location.id ? null : location.id)}
        >
          <Plus size={14} />
        </Button>
      </Card>

      {creating === location.id && (
        <Card className="mt-2 ml-5">
          <DynamicEntityForm schema={schema} values={values} onChange={(k: string, v: unknown) => setValues((s: any) => ({ ...s, [k]: v }))} />
          <div className="mt-3 flex gap-2">
            <Button onClick={() => onCreate(location.id)}>Сохранить</Button>
            <Button variant="secondary" onClick={() => setCreating(null)}>
              Отмена
            </Button>
          </div>
        </Card>
      )}

      {children && (
        <div className="mt-2 space-y-2">
          {children.map((child: LocationItem) => (
            <LocationNode
              key={child.id}
              location={child}
              depth={depth + 1}
              expanded={expanded}
              onToggle={onToggle}
              creating={creating}
              setCreating={setCreating}
              values={values}
              setValues={setValues}
              schema={schema}
              onCreate={onCreate}
            />
          ))}
          {children.length === 0 && (
            <p className="ml-5 text-xs text-ink/40">Вложенных локаций нет.</p>
          )}
        </div>
      )}
    </div>
  );
}
