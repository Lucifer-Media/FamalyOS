'use client';

import { useEffect, useState } from 'react';
import { apiFetch, ApiError } from '@/lib/api';
import { Card, Button, Badge } from '@/components/ui';
import { Gauge, Link as LinkIcon, Plus, Trash2, Receipt } from 'lucide-react';
import EntityLinkSelect from '@/components/ui/entity-link-select';
import { enumLabel } from '@/lib/enum-labels';

interface LineItem {
  service: string;
  amount: number;
}

interface Candidate {
  resourceType: string;
  meterNumber: string;
  value: number;
  rawLine: string;
  matchedMeterId?: string;
  matchedMeterTitle?: string;
}

interface ReconciliationCandidate {
  transactionId: string;
  transactionDate: string;
  transactionAmount: number;
  daysDifference: number;
  amountMatchType: 'exact' | 'rounded';
  confidence: number;
}

const RESOURCE_LABELS: Record<string, string> = {
  ELECTRICITY: 'Электричество',
  COLD_WATER: 'ХВС',
  HOT_WATER: 'ГВС',
  GAS: 'Газ',
  HEATING: 'Отопление',
  DRAINAGE: 'Водоотведение',
  OTHER: 'Другое',
};

export function UtilityBillPanels({ billId, billDate }: { billId: string; billDate?: string }) {
  const [candidates, setCandidates] = useState<Candidate[] | null>(null);
  const [breakdown, setBreakdown] = useState<string | null>(null);
  const [reconciliation, setReconciliation] = useState<ReconciliationCandidate[]>([]);
  const [isLinked, setIsLinked] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');

  // Редактируемые статьи расхода — независимо от того, что распознал OCR,
  // пользователь может добавлять/менять/удалять строки вручную (раздел
  // запроса: "ручная корректировка... статей расхода").
  const [lineItems, setLineItems] = useState<LineItem[]>([]);
  const [savingItems, setSavingItems] = useState(false);

  async function load() {
    try {
      const [meterData, reconData, bill] = await Promise.all([
        apiFetch<{ candidates: Candidate[]; breakdown: string | null }>(`/utilities/bills/${billId}/meter-candidates`),
        apiFetch<{ candidates?: ReconciliationCandidate[] }>(`/finance/reconciliation/${billId}`),
        apiFetch<{ attributes: { reconciledTransactionId?: string; lineItemsJson?: string } }>(`/entities/${billId}`),
      ]);
      setCandidates(meterData.candidates);
      setBreakdown(meterData.breakdown);
      setReconciliation(reconData.candidates ?? []);
      setIsLinked(Boolean(bill.attributes.reconciledTransactionId));
      try {
        setLineItems(bill.attributes.lineItemsJson ? JSON.parse(bill.attributes.lineItemsJson) : []);
      } catch {
        setLineItems([]);
      }
    } catch {
      // необязательные панели — если что-то не загрузилось, просто не показываем
    }
  }

  useEffect(() => {
    load().catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [billId]);

  async function saveLineItems(next: LineItem[]) {
    setLineItems(next);
    setSavingItems(true);
    try {
      await apiFetch(`/entities/${billId}`, {
        method: 'PATCH',
        body: { attributes: { lineItemsJson: JSON.stringify(next) } },
      });
    } catch {
      // не критично — попробует снова при следующем изменении
    } finally {
      setSavingItems(false);
    }
  }

  function addLineItem() {
    saveLineItems([...lineItems, { service: '', amount: 0 }]);
  }

  function updateLineItem(index: number, patch: Partial<LineItem>) {
    const next = lineItems.map((li, i) => (i === index ? { ...li, ...patch } : li));
    setLineItems(next); // локально сразу, без задержки на каждый символ
  }

  function commitLineItem(index: number) {
    saveLineItems(lineItems);
  }

  function removeLineItem(index: number) {
    saveLineItems(lineItems.filter((_, i) => i !== index));
  }

  // Ручной ввод показания — работает ВСЕГДА, независимо от того, удалось ли
  // распознать кандидатов автоматически (для табличных форматов вроде
  // Мосводоканала автоматика сознательно не пытается угадывать — здесь
  // единственный способ занести показание).
  const [manualMeterId, setManualMeterId] = useState<string | null>(null);
  const [manualValue, setManualValue] = useState('');
  const [manualResourceType, setManualResourceType] = useState('COLD_WATER');
  const [manualMeterNumber, setManualMeterNumber] = useState('');
  const [manualBusy, setManualBusy] = useState(false);

  async function onManualReading() {
    const value = Number(manualValue);
    if (!Number.isFinite(value)) {
      setError('Укажите корректное числовое показание');
      return;
    }
    if (!manualMeterId && !manualMeterNumber) {
      setError('Выберите существующий счётчик или укажите номер нового');
      return;
    }
    setManualBusy(true);
    setError('');
    try {
      const body = manualMeterId
        ? { meterId: manualMeterId, value, date: billDate ?? new Date().toISOString().slice(0, 10) }
        : {
            newMeter: { resourceType: manualResourceType, meterNumber: manualMeterNumber },
            value,
            date: billDate ?? new Date().toISOString().slice(0, 10),
          };
      await apiFetch(`/utilities/bills/${billId}/meter-readings`, { method: 'POST', body });
      setManualMeterId(null);
      setManualValue('');
      setManualMeterNumber('');
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Не удалось сохранить показание');
    } finally {
      setManualBusy(false);
    }
  }

  async function onConfirmReading(c: Candidate) {
    setBusy(c.meterNumber);
    setError('');
    try {
      const body = c.matchedMeterId
        ? { meterId: c.matchedMeterId, value: c.value, date: billDate ?? new Date().toISOString().slice(0, 10) }
        : {
            newMeter: { resourceType: c.resourceType, meterNumber: c.meterNumber },
            value: c.value,
            date: billDate ?? new Date().toISOString().slice(0, 10),
          };
      await apiFetch(`/utilities/bills/${billId}/meter-readings`, { method: 'POST', body });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Не удалось сохранить показание');
    } finally {
      setBusy(null);
    }
  }

  async function onLinkTransaction(transactionId: string) {
    setBusy(transactionId);
    try {
      await apiFetch(`/finance/reconciliation/${billId}/link/${transactionId}`, { method: 'POST' });
      await load();
    } catch {
      // молча — пользователь попробует снова
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <Card className="mt-4">
        <div className="flex items-center justify-between">
          <h3 className="flex items-center gap-2 font-display text-lg font-semibold">
            <Receipt size={18} /> Статьи расхода
          </h3>
          {savingItems && <span className="text-xs text-ink/40">Сохраняем…</span>}
        </div>
        <p className="mt-1 text-xs text-ink/50">
          Независимо от того, что удалось распознать автоматически, — добавляйте, правьте и удаляйте строки вручную.
        </p>
        <div className="mt-3 space-y-2">
          {lineItems.map((li, i) => (
            <div key={i} className="flex items-center gap-2">
              <input
                value={li.service}
                onChange={(e) => updateLineItem(i, { service: e.target.value })}
                onBlur={() => commitLineItem(i)}
                placeholder="Услуга (например, Отопление)"
                className="flex-1 rounded-card border border-line bg-paper px-3 py-1.5 text-sm"
              />
              <input
                type="number"
                step="0.01"
                value={li.amount}
                onChange={(e) => updateLineItem(i, { amount: Number(e.target.value) })}
                onBlur={() => commitLineItem(i)}
                placeholder="Сумма"
                className="w-32 rounded-card border border-line bg-paper px-3 py-1.5 text-sm"
              />
              <button onClick={() => removeLineItem(i)} className="text-ink/30 hover:text-clay" title="Удалить строку">
                <Trash2 size={16} />
              </button>
            </div>
          ))}
          {lineItems.length === 0 && <p className="text-sm text-ink/40">Строк пока нет.</p>}
        </div>
        <Button variant="secondary" className="mt-3" onClick={addLineItem}>
          <Plus size={14} /> Добавить строку
        </Button>
      </Card>

      <Card className="mt-4">
        <h3 className="flex items-center gap-2 font-display text-lg font-semibold">
          <Gauge size={18} /> Внести показание вручную
        </h3>
        <p className="mt-1 text-xs text-ink/50">
          Работает всегда — даже если автораспознавание не смогло разобрать таблицу показаний этой квитанции.
        </p>
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-xs text-ink/50">Счётчик (найти существующий)</label>
            <EntityLinkSelect value={manualMeterId ?? undefined} onChange={setManualMeterId} entityType="utility_meter" />
          </div>
          {!manualMeterId && (
            <>
              <div>
                <label className="mb-1 block text-xs text-ink/50">Или номер нового счётчика</label>
                <input
                  value={manualMeterNumber}
                  onChange={(e) => setManualMeterNumber(e.target.value)}
                  className="w-full rounded-card border border-line bg-paper px-3 py-1.5 text-sm"
                  placeholder="Например, 1345356"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs text-ink/50">Тип ресурса нового счётчика</label>
                <select
                  value={manualResourceType}
                  onChange={(e) => setManualResourceType(e.target.value)}
                  className="w-full rounded-card border border-line bg-paper px-3 py-1.5 text-sm"
                >
                  {['ELECTRICITY', 'COLD_WATER', 'HOT_WATER', 'GAS', 'HEATING', 'DRAINAGE', 'OTHER'].map((v) => (
                    <option key={v} value={v}>
                      {enumLabel(v)}
                    </option>
                  ))}
                </select>
              </div>
            </>
          )}
          <div>
            <label className="mb-1 block text-xs text-ink/50">Показание</label>
            <input
              type="number"
              step="0.001"
              value={manualValue}
              onChange={(e) => setManualValue(e.target.value)}
              className="w-full rounded-card border border-line bg-paper px-3 py-1.5 text-sm"
              placeholder="34.88"
            />
          </div>
        </div>
        <Button className="mt-3" onClick={onManualReading} disabled={manualBusy || !manualValue}>
          {manualBusy ? 'Сохраняем…' : 'Сохранить показание'}
        </Button>
        <ErrorTextInline>{error}</ErrorTextInline>
      </Card>

      {candidates && candidates.length > 0 && (
        <Card className="mt-4">
          <h3 className="flex items-center gap-2 font-display text-lg font-semibold">
            <Gauge size={18} /> Показания счётчиков, найденные в квитанции
          </h3>
          <p className="mt-1 text-xs text-ink/50">
            Разобрано из расшифровки квитанции. Подтвердите каждое — привяжется к уже заведённому счётчику
            (по номеру) или создаст новый.
          </p>
          <ul className="mt-3 space-y-2">
            {candidates.map((c) => (
              <li key={c.meterNumber} className="flex items-center justify-between rounded-card bg-paper-dim px-3 py-2 text-sm">
                <div>
                  <p className="text-ink">
                    {RESOURCE_LABELS[c.resourceType] ?? c.resourceType} · счётчик №{c.meterNumber} · показание{' '}
                    <strong>{c.value}</strong>
                  </p>
                  <p className="text-xs text-ink/40">
                    {c.matchedMeterId ? `Найден существующий счётчик: ${c.matchedMeterTitle}` : 'Счётчик будет создан заново'}
                  </p>
                </div>
                <Button variant="secondary" onClick={() => onConfirmReading(c)} disabled={busy === c.meterNumber}>
                  <Plus size={14} /> {busy === c.meterNumber ? 'Сохраняем…' : 'Подтвердить'}
                </Button>
              </li>
            ))}
          </ul>
          <ErrorTextInline>{error}</ErrorTextInline>
        </Card>
      )}

      {breakdown && (!candidates || candidates.length === 0) && (
        <Card className="mt-4">
          <h3 className="font-display text-lg font-semibold">Расшифровка по услугам (без автораспознавания)</h3>
          <p className="mt-1 text-xs text-ink/50">
            Формат этой квитанции не позволяет надёжно разобрать показания автоматически (например, таблица
            извлекается из PDF по столбцам, а не по строкам). Ниже — исходный текст, показания можно перенести
            вручную через раздел «ЖКХ → Счётчики».
          </p>
          <pre className="mt-2 whitespace-pre-wrap rounded-card bg-paper-dim p-3 text-xs text-ink/70">{breakdown}</pre>
        </Card>
      )}

      {!isLinked && reconciliation.length > 0 && (
        <Card className="mt-4">
          <h3 className="flex items-center gap-2 font-display text-lg font-semibold">
            <LinkIcon size={18} /> Похожие банковские операции
          </h3>
          <p className="mt-1 text-xs text-ink/50">Совпадение по сумме — подтвердите, если это действительно оплата этой квитанции.</p>
          <ul className="mt-3 space-y-2">
            {reconciliation.slice(0, 3).map((c) => (
              <li key={c.transactionId} className="flex items-center justify-between rounded-card bg-paper-dim px-3 py-2 text-sm">
                <span>
                  {c.transactionDate} · {c.transactionAmount} ₽ · разница {c.daysDifference} дн.
                  {c.amountMatchType === 'exact' && <Badge tone="moss">точное совпадение</Badge>}
                </span>
                <Button variant="secondary" onClick={() => onLinkTransaction(c.transactionId)} disabled={busy === c.transactionId}>
                  Связать
                </Button>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </>
  );
}

function ErrorTextInline({ children }: { children: string }) {
  if (!children) return null;
  return <p className="mt-2 text-xs text-clay">{children}</p>;
}
