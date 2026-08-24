'use client';

import { useEffect, useState } from 'react';
import { AppShell } from '@/components/app-shell';
import { useRequireAuth } from '@/lib/use-require-auth';
import { useEntityTypeList } from '@/lib/use-entity-types';
import { apiFetch, ApiError } from '@/lib/api';
import { Button, Card, Badge } from '@/components/ui';
import Link from 'next/link';
import { Link as LinkIcon, Zap } from 'lucide-react';

interface BillSummary {
  id: string;
  title: string;
  attributes: { totalAmount?: number; period?: string; propertyId?: string; reconciledTransactionId?: string };
}

interface ReconciliationCandidate {
  transactionId: string;
  transactionDate: string;
  transactionAmount: number;
  daysDifference: number;
  amountMatchType: 'exact' | 'rounded';
  confidence: number;
}

export default function UtilitiesPage() {
  const { loading, isAuthenticated } = useRequireAuth();
  const { schemas } = useEntityTypeList();
  const [bills, setBills] = useState<BillSummary[]>([]);
  const [candidatesByBill, setCandidatesByBill] = useState<Record<string, ReconciliationCandidate[]>>({});
  const [linking, setLinking] = useState<string | null>(null);

  async function load() {
    const data = await apiFetch<BillSummary[]>('/entities?entityType=utility_bill');
    setBills(data);
    // Для несвязанных квитанций сразу подгружаем кандидатов на сверку.
    for (const bill of data) {
      if (!bill.attributes.reconciledTransactionId) {
        apiFetch<{ candidates: ReconciliationCandidate[] }>(`/finance/reconciliation/${bill.id}`)
          .then((r) => setCandidatesByBill((s) => ({ ...s, [bill.id]: r.candidates })))
          .catch(() => undefined);
      }
    }
  }

  useEffect(() => {
    load().catch(() => undefined);
  }, []);

  async function onLink(billId: string, transactionId: string) {
    setLinking(billId);
    try {
      await apiFetch(`/finance/reconciliation/${billId}/link/${transactionId}`, { method: 'POST' });
      await load();
    } catch (e) {
      // молча — карточка просто не обновится, пользователь попробует снова
    } finally {
      setLinking(null);
    }
  }

  if (loading || !isAuthenticated) return null;

  return (
    <AppShell>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-2xl font-semibold text-ink">ЖКХ</h1>
          <p className="mt-1 text-sm text-ink/60">Квитанции, показания счётчиков и сверка с банковскими операциями.</p>
        </div>
        <div className="flex gap-2">
          <Link href="/documents/utility_bill">
            <Button variant="secondary">Квитанции</Button>
          </Link>
          <Link href="/documents/utility_meter">
            <Button variant="secondary">
              <Zap size={16} /> Счётчики
            </Button>
          </Link>
        </div>
      </div>

      <div className="mt-6 space-y-3">
        {bills.map((bill) => {
          const candidates = candidatesByBill[bill.id] ?? [];
          const isLinked = Boolean(bill.attributes.reconciledTransactionId);
          return (
            <Card key={bill.id}>
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-medium text-ink">{bill.title}</p>
                  <p className="text-xs text-ink/40">
                    {bill.attributes.period} · {bill.attributes.totalAmount} ₽
                  </p>
                </div>
                {isLinked ? (
                  <Badge tone="moss">
                    <LinkIcon size={12} /> Связана с операцией
                  </Badge>
                ) : candidates.length > 0 ? (
                  <Badge tone="gold">Найдены совпадения по сумме</Badge>
                ) : (
                  <Badge tone="default">Не сверено</Badge>
                )}
              </div>

              {!isLinked && candidates.length > 0 && (
                <div className="mt-3 space-y-2 border-t border-line pt-3">
                  <p className="text-xs text-ink/50">
                    Совпадение по сумме — раздел 25 ТЗ: подтвердите, если это действительно оплата этой квитанции.
                  </p>
                  {candidates.slice(0, 3).map((c) => (
                    <div key={c.transactionId} className="flex items-center justify-between rounded-card bg-paper-dim px-3 py-2 text-sm">
                      <span>
                        {c.transactionDate} · {c.transactionAmount} ₽ · разница {c.daysDifference} дн.
                      </span>
                      <Button
                        variant="secondary"
                        onClick={() => onLink(bill.id, c.transactionId)}
                        disabled={linking === bill.id}
                      >
                        Связать
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          );
        })}
        {bills.length === 0 && <p className="text-sm text-ink/50">Квитанций ЖКХ пока нет.</p>}
      </div>
    </AppShell>
  );
}
