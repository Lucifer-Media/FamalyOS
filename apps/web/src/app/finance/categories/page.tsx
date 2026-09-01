'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { AppShell } from '@/components/app-shell';
import { useRequireAuth } from '@/lib/use-require-auth';
import { useEntityTypeSchema } from '@/lib/use-entity-types';
import { DynamicEntityForm } from '@/components/dynamic-entity-form';
import { FinanceSubNav } from '@/components/finance-subnav';
import { apiFetch, ApiError } from '@/lib/api';
import { Button, Card, ErrorText, Badge } from '@/components/ui';
import { Plus, ChevronRight, Tag } from 'lucide-react';

interface CategoryEntity {
  id: string;
  title: string;
  status: string;
  attributes: {
    name?: string;
    categoryType?: 'EXPENSE' | 'INCOME' | 'TRANSFER';
    parentCategoryId?: string;
    color?: string;
    isActive?: boolean;
  };
}

const TYPE_LABEL: Record<string, { label: string; tone: 'clay' | 'moss' | 'gold' }> = {
  EXPENSE: { label: 'Расход', tone: 'clay' },
  INCOME: { label: 'Доход', tone: 'moss' },
  TRANSFER: { label: 'Перевод', tone: 'gold' },
};

export default function CategoriesPage() {
  const { loading, isAuthenticated } = useRequireAuth();
  const { schema } = useEntityTypeSchema('financial_category');
  const [categories, setCategories] = useState<CategoryEntity[]>([]);
  const [creating, setCreating] = useState(false);
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function load() {
    const data = await apiFetch<CategoryEntity[]>('/entities?entityType=financial_category');
    setCategories(data);
  }

  useEffect(() => {
    load().catch((e) => setError(e.message));
  }, []);

  async function onCreate() {
    if (!schema) return;
    setBusy(true);
    setError('');
    try {
      const name = (values.name as string) || 'Категория';
      await apiFetch('/entities', {
        method: 'POST',
        body: { entityType: 'financial_category', title: name, attributes: values },
      });
      setCreating(false);
      setValues({});
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Не удалось создать категорию');
    } finally {
      setBusy(false);
    }
  }

  if (loading || !isAuthenticated) return null;

  const roots = categories.filter((c) => !c.attributes.parentCategoryId);
  const childrenOf = (id: string) => categories.filter((c) => c.attributes.parentCategoryId === id);

  return (
    <AppShell>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-semibold text-ink">Категории</h1>
          <p className="mt-1 text-sm text-ink/60">Категории и подкатегории доходов/расходов для операций и бюджетов.</p>
        </div>
        <Button onClick={() => setCreating((v) => !v)} disabled={!schema}>
          <Plus size={16} /> Добавить категорию
        </Button>
      </div>

      <div className="mt-4">
        <FinanceSubNav active="/finance/categories" />
      </div>

      <ErrorText>{error}</ErrorText>

      {creating && schema && (
        <Card className="animate-in mt-4">
          <DynamicEntityForm schema={schema} values={values} onChange={(k, v) => setValues((s) => ({ ...s, [k]: v }))} />
          <div className="mt-3 flex gap-2">
            <Button onClick={onCreate} disabled={busy}>
              {busy ? 'Сохраняем…' : 'Сохранить'}
            </Button>
            <Button variant="secondary" onClick={() => setCreating(false)}>
              Отмена
            </Button>
          </div>
        </Card>
      )}

      <Card className="mt-6">
        {roots.length === 0 && <p className="text-sm text-ink/50">Категорий пока нет.</p>}
        <ul className="divide-y divide-line">
          {roots.map((root) => (
            <CategoryRow key={root.id} category={root} childrenOf={childrenOf} depth={0} />
          ))}
        </ul>
      </Card>
    </AppShell>
  );
}

function CategoryRow({
  category,
  childrenOf,
  depth,
}: {
  category: CategoryEntity;
  childrenOf: (id: string) => CategoryEntity[];
  depth: number;
}) {
  const children = childrenOf(category.id);
  const type = category.attributes.categoryType ? TYPE_LABEL[category.attributes.categoryType] : null;

  return (
    <li className="py-2">
      <Link
        href={`/documents/financial_category/${category.id}`}
        style={{ paddingLeft: depth * 20 }}
        className="flex items-center justify-between gap-2 rounded-card px-1 py-1.5 text-sm hover:bg-paper-dim"
      >
        <span className="flex items-center gap-2">
          {depth > 0 && <ChevronRight size={14} className="text-ink/30" />}
          {category.attributes.color ? (
            <span
              className="h-3 w-3 shrink-0 rounded-full"
              style={{ background: category.attributes.color }}
            />
          ) : (
            <Tag size={14} className="text-ink/30" />
          )}
          <span className="text-ink">{category.title}</span>
          {category.status === 'ARCHIVED' && <Badge tone="gold">В архиве</Badge>}
        </span>
        {type && <Badge tone={type.tone}>{type.label}</Badge>}
      </Link>
      {children.length > 0 && (
        <ul className="divide-y divide-line">
          {children.map((child) => (
            <CategoryRow key={child.id} category={child} childrenOf={childrenOf} depth={depth + 1} />
          ))}
        </ul>
      )}
    </li>
  );
}
