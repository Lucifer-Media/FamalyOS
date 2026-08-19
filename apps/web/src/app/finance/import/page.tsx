'use client';

import { useState, useEffect } from 'react';
import { AppShell } from '@/components/app-shell';
import { useRequireAuth } from '@/lib/use-require-auth';
import { Card, Button, Input, Select } from '@/components/ui';
import { api } from '@/lib/api';

interface FinancialOperation {
  id: string;
  attributes: {
    operationDate: string;
    amount: number;
    currency: string;
    operationType: 'INCOME' | 'EXPENSE' | 'TRANSFER';
    category?: string;
    description?: string;
    merchantName?: string;
  };
}

export default function ImportPage() {
  const { loading, isAuthenticated, user } = useRequireAuth();
  const [preview, setPreview] = useState<any[]>([]);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [importing, setImporting] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [bankFormat, setBankFormat] = useState('TINKOFF');
  const [importResult, setImportResult] = useState<{ imported: number; skipped: number } | null>(null);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setSelectedFile(file);
      setImportResult(null);
    }
  };

  const loadPreview = async () => {
    if (!selectedFile) return;
    
    setLoadingPreview(true);
    try {
      const formData = new FormData();
      formData.append('file', selectedFile);
      formData.append('bankFormat', bankFormat);
      
      // Загружаем файл на сервер для превью
      const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001'}/finance/import/preview`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${localStorage.getItem('token')}`,
        },
        body: formData,
      });
      
      if (response.ok) {
        const data = await response.json();
        setPreview(data.operations || []);
      } else {
        alert('Ошибка загрузки файла');
      }
    } catch (error) {
      console.error('Ошибка превью:', error);
      alert('Не удалось загрузить файл');
    } finally {
      setLoadingPreview(false);
    }
  };

  const handleImport = async () => {
    if (!selectedFile) return;
    
    setImporting(true);
    try {
      const formData = new FormData();
      formData.append('file', selectedFile);
      formData.append('bankFormat', bankFormat);
      formData.append('familySpaceId', user?.familySpaceId || '');
      
      const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001'}/finance/import`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${localStorage.getItem('token')}`,
        },
        body: formData,
      });
      
      if (response.ok) {
        const data = await response.json();
        setImportResult({
          imported: data.imported || 0,
          skipped: data.skipped || 0,
        });
        setPreview([]);
        setSelectedFile(null);
      } else {
        alert('Ошибка импорта');
      }
    } catch (error) {
      console.error('Ошибка импорта:', error);
      alert('Не удалось выполнить импорт');
    } finally {
      setImporting(false);
    }
  };

  if (loading || !isAuthenticated) {
    return (
      <AppShell>
        <div className="flex items-center justify-center py-12">
          <p className="text-ink/60">Загрузка...</p>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <h1 className="font-display text-2xl font-semibold text-ink">Импорт банковской выписки</h1>
      <p className="mt-1 text-sm text-ink/60">
        Загрузите выписку из банка в формате OFX или CSV для автоматического создания операций.
      </p>

      <Card className="mt-4 p-6">
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-ink mb-2">Выберите файл выписки</label>
            <Input
              type="file"
              accept=".ofx,.csv,.xlsx,.xls"
              onChange={handleFileSelect}
            />
            {selectedFile && (
              <p className="mt-2 text-sm text-ink/60">
                Выбран файл: <span className="font-medium">{selectedFile.name}</span>
              </p>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium text-ink mb-2">Формат банка (для CSV)</label>
            <Select
              value={bankFormat}
              onChange={(e) => setBankFormat(e.target.value)}
            >
              <option value="TINKOFF">Т-Банк (Тинькофф)</option>
              <option value="ALFA">Альфа-Банк</option>
              <option value="OTHER">Другой банк</option>
            </Select>
          </div>

          <div className="flex gap-2">
            <Button
              onClick={loadPreview}
              disabled={!selectedFile || loadingPreview}
              variant="outline"
            >
              {loadingPreview ? 'Загрузка...' : 'Показать превью'}
            </Button>
            <Button
              onClick={handleImport}
              disabled={!selectedFile || importing || preview.length === 0}
              variant="primary"
            >
              {importing ? 'Импорт...' : 'Импортировать операции'}
            </Button>
          </div>
        </div>
      </Card>

      {importResult && (
        <Card className="mt-4 p-4 bg-green-50">
          <p className="text-green-800 font-medium">
            Импорт завершён! Создано операций: {importResult.imported}
          </p>
          {importResult.skipped > 0 && (
            <p className="text-green-700 text-sm mt-1">
              Пропущено дубликатов: {importResult.skipped}
            </p>
          )}
        </Card>
      )}

      {preview.length > 0 && (
        <Card className="mt-4 p-4">
          <h2 className="font-display text-lg font-semibold text-ink mb-4">
            Превью операций ({preview.length})
          </h2>
          <div className="max-h-96 overflow-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-white">
                <tr className="border-b">
                  <th className="py-2 text-left text-ink/60">Дата</th>
                  <th className="py-2 text-left text-ink/60">Тип</th>
                  <th className="py-2 text-left text-ink/60">Описание</th>
                  <th className="py-2 text-right text-ink/60">Сумма</th>
                </tr>
              </thead>
              <tbody>
                {preview.map((op, idx) => (
                  <tr key={idx} className="border-b last:border-0">
                    <td className="py-2 text-ink">{op.date}</td>
                    <td className="py-2">
                      <span className={op.type === 'INCOME' ? 'text-green-600' : 'text-red-600'}>
                        {op.type === 'INCOME' ? 'Доход' : 'Расход'}
                      </span>
                    </td>
                    <td className="py-2 text-ink/60">
                      {op.description || op.merchant || '—'}
                    </td>
                    <td className="py-2 text-right font-medium">
                      <span className={op.type === 'INCOME' ? 'text-green-600' : 'text-red-600'}>
                        {op.type === 'INCOME' ? '+' : '-'}{op.amount} {op.currency}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-xs text-ink/40">
            После импорта вы сможете отредактировать категории и описания операций вручную.
          </p>
        </Card>
      )}

      <Card className="mt-4 p-4 bg-ink/5">
        <h3 className="font-medium text-ink mb-2">Поддерживаемые форматы:</h3>
        <ul className="text-sm text-ink/60 space-y-1">
          <li>• <strong>OFX</strong> — универсальный формат для большинства банков</li>
          <li>• <strong>CSV (Т-Банк)</strong> — выписка из Т-Банка (Тинькофф)</li>
          <li>• <strong>CSV (Альфа-Банк)</strong> — выписка из Альфа-Банка</li>
          <li>• <strong>XLSX</strong> — требует дополнительной настройки (см. документацию)</li>
        </ul>
      </Card>
    </AppShell>
  );
}
