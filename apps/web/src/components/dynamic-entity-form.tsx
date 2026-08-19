'use client';

import { EntityTypeSchema, FieldSchema } from '@/lib/entity-type-schemas';
import { Field, Input, Textarea } from '@/components/ui';
import EntityLinkSelect from '@/components/ui/entity-link-select';

interface Props {
  schema: EntityTypeSchema;
  values: Record<string, unknown>;
  onChange: (key: string, value: unknown) => void;
  disabled?: boolean;
  /** Уверенность OCR-извлечения по каждому полю (0..1) — если передана,
   * поля с низкой уверенностью подсвечиваются, чтобы пользователь
   * обратил на них особое внимание перед сохранением (раздел 9 ТЗ). */
  fieldConfidence?: Record<string, number>;
}

/**
 * Рендерит форму по декларативной схеме (FieldSchema[]) типа сущности.
 * Это UI-воплощение принципа «общая оболочка + специализированная
 * структура»: один компонент обслуживает и паспорт, и компьютер, и
 * медицинское заключение — набор полей приходит с backend.
 */
export function DynamicEntityForm({ schema, values, onChange, disabled, fieldConfidence }: Props) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      {schema.fields.map((field) => (
        <div key={field.key} className={field.type === 'text' ? 'sm:col-span-2' : ''}>
          <DynamicField
            field={field}
            value={values[field.key]}
            onChange={(v) => onChange(field.key, v)}
            disabled={disabled}
            confidence={fieldConfidence?.[field.key]}
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
  confidence,
}: {
  field: FieldSchema;
  value: unknown;
  onChange: (value: unknown) => void;
  disabled?: boolean;
  confidence?: number;
}) {
  const baseLabel = field.required ? `${field.label} *` : field.label;
  // Низкая уверенность OCR по конкретному полю — визуально предупреждаем,
  // не блокируя ввод (пользователь и так видит поле и может исправить).
  const confidenceNote =
    confidence != null
      ? confidence < 0.6
        ? ` ⚠️ низкая уверенность OCR (~${Math.round(confidence * 100)}%)`
        : ` (уверенность OCR ~${Math.round(confidence * 100)}%)`
      : '';
  const label = baseLabel + confidenceNote;

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

  // 'link' — теперь используется компонент с автодополнением и поиском
  if (field.type === 'link' && field.linkTarget) {
    return (
      <EntityLinkSelect
        label={label}
        value={value as string | undefined}
        onChange={onChange}
        entityType={field.linkTarget}
        placeholder={`Поиск ${field.label.toLowerCase()}...`}
        disabled={disabled}
        allowClear={!field.required}
      />
    );
  }

  // 'string' | 'link' без linkTarget (fallback для обратной совместимости)
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
