'use client';

import { ReactNode, useState, FormEvent } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import clsx from 'clsx';
import { BookOpen, FolderClosed, Home, LogOut, Menu, Search, ShieldCheck, Users, X, FileStack, MapPin, HeartPulse, ScanLine, Wallet, Zap, Sparkles, UserCog } from 'lucide-react';
import { useAuth } from '@/lib/auth-context';

const NAV_ITEMS = [
  { href: '/dashboard', label: 'Обзор', icon: Home },
  { href: '/documents', label: 'Документы', icon: FileStack },
  { href: '/document-intake', label: 'Загрузка документа', icon: ScanLine },
  { href: '/assistant', label: 'Ассистент', icon: Sparkles },
  { href: '/finance', label: 'Финансы', icon: Wallet },
  { href: '/utilities', label: 'ЖКХ', icon: Zap },
  { href: '/locations', label: 'Локации', icon: MapPin },
  { href: '/medical', label: 'Медицина', icon: HeartPulse },
  { href: '/knowledge-base', label: 'База знаний', icon: BookOpen },
  { href: '/files', label: 'Файлы', icon: FolderClosed },
  { href: '/members', label: 'Участники', icon: Users },
  { href: '/audit-log', label: 'Журнал аудита', icon: ShieldCheck, ownerOnly: true },
];

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { familySpaces, currentFamilySpaceId, currentRole, setCurrentFamilySpace, logout } = useAuth();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [query, setQuery] = useState('');

  const visibleItems = NAV_ITEMS.filter((item) => !item.ownerOnly || ['OWNER', 'PARTNER'].includes(currentRole ?? ''));

  function onSearchSubmit(e: FormEvent) {
    e.preventDefault();
    if (query.trim()) router.push(`/search?q=${encodeURIComponent(query.trim())}`);
  }

  return (
    <div className="min-h-screen bg-paper">
      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 hidden w-60 flex-col border-r border-line bg-paper-card md:flex">
        <div className="flex h-16 items-center gap-2 border-b border-line px-5">
          <span className="font-display text-lg font-semibold text-ink">Family OS</span>
        </div>
        <nav className="flex-1 space-y-1 p-3">
          {visibleItems.map((item) => (
            <SidebarLink key={item.href} {...item} active={pathname.startsWith(item.href)} />
          ))}
        </nav>
        <div className="border-t border-line p-3">
          <FamilySpaceSwitcher
            familySpaces={familySpaces}
            currentFamilySpaceId={currentFamilySpaceId}
            onChange={setCurrentFamilySpace}
          />
          <Link href="/profile" className="mt-2 flex w-full items-center gap-2 rounded-card px-3 py-2 text-sm text-ink/60 hover:bg-paper-dim">
            <UserCog size={16} /> Мой профиль
          </Link>
          <button
            onClick={logout}
            className="flex w-full items-center gap-2 rounded-card px-3 py-2 text-sm text-ink/60 hover:bg-paper-dim"
          >
            <LogOut size={16} /> Выйти
          </button>
        </div>
      </aside>

      {/* Mobile top bar */}
      <header className="sticky top-0 z-20 flex h-14 items-center justify-between border-b border-line bg-paper-card px-4 md:hidden">
        <span className="font-display text-lg font-semibold text-ink">Family OS</span>
        <button onClick={() => setMobileOpen(true)} aria-label="Открыть меню" className="p-1">
          <Menu size={22} />
        </button>
      </header>

      {/* Mobile menu drawer */}
      {mobileOpen && (
        <div className="fixed inset-0 z-30 bg-ink/40 md:hidden" onClick={() => setMobileOpen(false)}>
          <div
            className="absolute inset-y-0 left-0 w-72 bg-paper-card p-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex items-center justify-between">
              <span className="font-display text-lg font-semibold">Меню</span>
              <button onClick={() => setMobileOpen(false)} aria-label="Закрыть меню">
                <X size={22} />
              </button>
            </div>
            <FamilySpaceSwitcher
              familySpaces={familySpaces}
              currentFamilySpaceId={currentFamilySpaceId}
              onChange={setCurrentFamilySpace}
            />
            <nav className="mt-4 space-y-1">
              {visibleItems.map((item) => (
                <SidebarLink
                  key={item.href}
                  {...item}
                  active={pathname.startsWith(item.href)}
                  onClick={() => setMobileOpen(false)}
                />
              ))}
            </nav>
            <Link href="/profile" onClick={() => setMobileOpen(false)} className="mt-4 flex w-full items-center gap-2 rounded-card px-3 py-2 text-sm text-ink/60 hover:bg-paper-dim">
              <UserCog size={16} /> Мой профиль
            </Link>
            <button
              onClick={logout}
              className="flex w-full items-center gap-2 rounded-card px-3 py-2 text-sm text-ink/60 hover:bg-paper-dim"
            >
              <LogOut size={16} /> Выйти
            </button>
          </div>
        </div>
      )}

      <div className="md:pl-60 print:pl-0">
        <div className="hidden items-center gap-3 border-b border-line bg-paper-card px-6 py-3 md:flex print:hidden">
          <form onSubmit={onSearchSubmit} className="relative w-full max-w-md">
            <Search size={16} className="pointer-events-none absolute left-3 top-2.5 text-ink/40" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Поиск по семейной базе знаний и записям…"
              className="w-full rounded-card border border-line bg-paper py-2 pl-9 pr-3 text-sm focus:border-moss-500"
            />
          </form>
        </div>
        <main className="mx-auto max-w-5xl px-4 py-6 pb-24 md:px-8 md:py-8 md:pb-8">{children}</main>
      </div>

      {/* Mobile bottom nav */}
      <nav className="fixed inset-x-0 bottom-0 z-20 flex border-t border-line bg-paper-card md:hidden">
        {visibleItems.slice(0, 5).map((item) => {
          const Icon = item.icon;
          const active = pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={clsx(
                'flex flex-1 flex-col items-center gap-0.5 py-2 text-[11px]',
                active ? 'text-moss-600' : 'text-ink/50',
              )}
            >
              <Icon size={20} />
              {item.label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}

function SidebarLink({
  href,
  label,
  icon: Icon,
  active,
  onClick,
}: {
  href: string;
  label: string;
  icon: any;
  active: boolean;
  onClick?: () => void;
}) {
  return (
    <Link
      href={href}
      onClick={onClick}
      className={clsx(
        'flex items-center gap-3 rounded-card border-l-2 px-3 py-2 text-sm font-medium transition-colors',
        active
          ? 'border-moss-500 bg-moss-50 text-moss-700'
          : 'border-transparent text-ink/70 hover:bg-paper-dim',
      )}
    >
      <Icon size={17} />
      {label}
    </Link>
  );
}

function FamilySpaceSwitcher({
  familySpaces,
  currentFamilySpaceId,
  onChange,
}: {
  familySpaces: { id: string; name: string; role: string }[];
  currentFamilySpaceId: string | null;
  onChange: (id: string) => void;
}) {
  if (familySpaces.length === 0) return null;
  return (
    <select
      value={currentFamilySpaceId ?? ''}
      onChange={(e) => onChange(e.target.value)}
      className="w-full rounded-card border border-line bg-paper px-2 py-1.5 text-sm"
      aria-label="Выбор семейного пространства"
    >
      {familySpaces.map((s) => (
        <option key={s.id} value={s.id}>
          {s.name} ({roleLabel(s.role)})
        </option>
      ))}
    </select>
  );
}

function roleLabel(role: string): string {
  const map: Record<string, string> = {
    OWNER: 'владелец',
    PARTNER: 'партнёр',
    ADULT: 'взрослый',
    CHILD: 'ребёнок',
    RELATIVE: 'родственник',
    GUEST: 'гость',
    LIMITED: 'ограниченный',
  };
  return map[role] ?? role;
}
