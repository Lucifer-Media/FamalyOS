'use client';

import Link from 'next/link';
import clsx from 'clsx';

const ITEMS: { href: string; label: string }[] = [
  { href: '/finance', label: 'Счета' },
  { href: '/finance/transactions', label: 'Транзакции' },
  { href: '/finance/dashboard', label: 'Дашборд' },
  { href: '/finance/budgets', label: 'Бюджеты' },
  { href: '/finance/calendar', label: 'Календарь' },
  { href: '/finance/recurring', label: 'Подписки' },
  { href: '/finance/goals', label: 'Копилки' },
  { href: '/finance/categories', label: 'Категории' },
  { href: '/finance/rules', label: 'Правила' },
  { href: '/finance/analytics', label: 'Аналитика' },
  { href: '/finance/reports', label: 'ИИ-отчёты' },
  { href: '/finance/portfolio', label: 'Портфель' },
];

/**
 * Общая под-навигация раздела «Финансы». На телефоне — одна строка с
 * горизонтальной прокруткой (12 пунктов не помещаются), на десктопе — перенос.
 */
export function FinanceSubNav({ active }: { active: string }) {
  return (
    <nav className="-mx-4 flex gap-1.5 overflow-x-auto px-4 pb-1 md:mx-0 md:flex-wrap md:overflow-visible md:px-0 md:pb-0">
      {ITEMS.map((item) => (
        <Link
          key={item.href}
          href={item.href}
          className={clsx(
            'shrink-0 whitespace-nowrap rounded-card px-3 py-1.5 text-sm font-medium transition-colors',
            item.href === active ? 'bg-moss-500 text-white' : 'bg-paper-dim text-ink/70 hover:bg-line/40',
          )}
        >
          {item.label}
        </Link>
      ))}
    </nav>
  );
}
