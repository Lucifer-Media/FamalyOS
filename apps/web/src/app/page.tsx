'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';

export default function HomePage() {
  const router = useRouter();
  const { isAuthenticated, loading } = useAuth();

  useEffect(() => {
    if (loading) return;
    router.replace(isAuthenticated ? '/dashboard' : '/login');
  }, [loading, isAuthenticated, router]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-paper text-ink/60">
      Загрузка Family OS…
    </div>
  );
}
