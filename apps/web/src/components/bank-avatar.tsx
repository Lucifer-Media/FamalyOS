'use client';

import { getBankBrand } from '@/lib/bank-branding';

export function BankAvatar({
  bankName,
  brandColor,
  size = 36,
}: {
  bankName?: string | null;
  brandColor?: string | null;
  size?: number;
}) {
  const brand = getBankBrand(bankName, brandColor);
  return (
    <div
      title={bankName || undefined}
      style={{ width: size, height: size, background: brand.bg, color: brand.fg, fontSize: Math.max(10, size * 0.36) }}
      className="flex shrink-0 items-center justify-center rounded-xl font-semibold"
    >
      {brand.initials}
    </div>
  );
}
