'use client';

import Link from 'next/link';
import clsx from 'clsx';

const ITEMS: { href: string; label: string }[] = [
  { href: '/finance', label: 'Счета' },
  { href: '/finance/transactions', label: 'Транзакции' },
  { href: '/finance/dashboard', label: 'Дашборд' },
  { href: '/finance/budgets', label: 'Бюджеты' },
  { href: '/finance/calendar', label: 'Календарь' },
  { href: '/finance/categories', label: 'Категории' },
  { href: '/finance/analytics', label: 'Аналитика' },
  { href: '/finance/portfolio', label: 'Портфель' },
];

/**
 * Раньше переход к категориям/подкатегориям был недостижим из раздела
 * "Финансы" (пункт 7 запроса на доработку) — общая под-навигация
 * подключается на всех страницах финансов, чтобы разделы были достижимы
 * друг из друга в один клик.
 */
export function FinanceSubNav({ active }: { active: string }) {
  return (
    <nav className="flex flex-wrap gap-1.5">
      {ITEMS.map((item) => (
        <Link
          key={item.href}
          href={item.href}
          className={clsx(
            'rounded-card px-3 py-1.5 text-sm font-medium transition-colors',
            item.href === active
              ? 'bg-moss-500 text-white'
              : 'bg-paper-dim text-ink/70 hover:bg-line/40',
          )}
        >
          {item.label}
        </Link>
      ))}
    </nav>
  );
}
