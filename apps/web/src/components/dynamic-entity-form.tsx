'use client';

import { EntityTypeSchema, FieldSchema } from '@/lib/entity-type-schemas';
import { Field, Input, Textarea } from '@/components/ui';

interface Props {
  schema: EntityTypeSchema;
  values: Record<string, unknown>;
  onChange: (key: string, value: unknown) => void;
  disabled?: boolean;
}

/**
 * Рендерит форму по декларативной схеме (FieldSchema[]) типа сущности.
 * Это UI-воплощение принципа «общая оболочка + специализированная
 * структура»: один компонент обслуживает и паспорт, и компьютер, и
 * медицинское заключение — набор полей приходит с backend.
 */
export function DynamicEntityForm({ schema, values, onChange, disabled }: Props) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      {schema.fields.map((field) => (
        <div key={field.key} className={field.type === 'text' ? 'sm:col-span-2' : ''}>
          <DynamicField
            field={field}
            value={values[field.key]}
            onChange={(v) => onChange(field.key, v)}
            disabled={disabled}
          />
        </div>
      ))}
    </div>
  );
}

function DynamicField({
  field,
  value,
  onChange,
  disabled,
}: {
  field: FieldSchema;
  value: unknown;
  onChange: (value: unknown) => void;
  disabled?: boolean;
}) {
  const label = field.required ? `${field.label} *` : field.label;

  if (field.type === 'text') {
    return (
      <Field label={label}>
        <Textarea
          value={(value as string) ?? ''}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          rows={3}
        />
      </Field>
    );
  }

  if (field.type === 'boolean') {
    return (
      <label className="flex items-center gap-2 pt-6 text-sm text-ink/80">
        <input
          type="checkbox"
          checked={Boolean(value)}
          onChange={(e) => onChange(e.target.checked)}
          disabled={disabled}
          className="h-4 w-4 rounded border-line"
        />
        {label}
      </label>
    );
  }

  if (field.type === 'enum') {
    return (
      <Field label={label}>
        <select
          value={(value as string) ?? ''}
          onChange={(e) => onChange(e.target.value || undefined)}
          disabled={disabled}
          className="w-full rounded-card border border-line bg-white px-3 py-2 text-sm"
        >
          <option value="">—</option>
          {(field.enumValues ?? []).map((v) => (
            <option key={v} value={v}>
              {v}
            </option>
          ))}
        </select>
      </Field>
    );
  }

  if (field.type === 'number') {
    return (
      <Field label={label}>
        <Input
          type="number"
          value={value === undefined || value === null ? '' : String(value)}
          onChange={(e) => onChange(e.target.value === '' ? undefined : Number(e.target.value))}
          disabled={disabled}
        />
      </Field>
    );
  }

  if (field.type === 'date') {
    return (
      <Field label={label}>
        <Input
          type="date"
          value={(value as string) ?? ''}
          onChange={(e) => onChange(e.target.value || undefined)}
          disabled={disabled}
        />
      </Field>
    );
  }

  // 'string' | 'link' (для link в этой итерации — обычное текстовое поле с id;
  // полноценный выбор через поиск — техдолг, см. docs/TECH_DEBT.md)
  return (
    <Field label={label} hint={field.type === 'link' ? 'Вставьте id связанной записи' : undefined}>
      <Input
        value={(value as string) ?? ''}
        onChange={(e) => onChange(e.target.value || undefined)}
        disabled={disabled}
      />
    </Field>
  );
}
