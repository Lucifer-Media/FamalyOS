'use client';

import { ButtonHTMLAttributes, HTMLAttributes, InputHTMLAttributes, LabelHTMLAttributes, ReactNode, TextareaHTMLAttributes } from 'react';
import clsx from 'clsx';

export function Button({
  className,
  variant = 'primary',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'ghost' | 'danger' }) {
  return (
    <button
      className={clsx(
        'inline-flex items-center justify-center gap-2 rounded-card px-4 py-2 text-sm font-medium transition-[background-color,transform] duration-150 active:scale-[0.97] disabled:opacity-50 disabled:cursor-not-allowed disabled:active:scale-100',
        variant === 'primary' && 'bg-moss-500 text-white hover:bg-moss-600',
        variant === 'secondary' && 'bg-paper-dim text-ink border border-line hover:bg-line/40',
        variant === 'ghost' && 'text-ink hover:bg-paper-dim',
        variant === 'danger' && 'bg-clay text-white hover:opacity-90',
        className,
      )}
      {...props}
    />
  );
}

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium text-ink/80">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-ink/50">{hint}</span>}
    </label>
  );
}

export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={clsx(
        'w-full rounded-card border border-line bg-white px-3 py-2 text-sm text-ink placeholder:text-ink/40 focus:border-moss-500',
        props.className,
      )}
    />
  );
}

export function Textarea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      {...props}
      className={clsx(
        'w-full rounded-card border border-line bg-white px-3 py-2 text-sm text-ink placeholder:text-ink/40 focus:border-moss-500',
        props.className,
      )}
    />
  );
}

export function Card({
  children,
  className,
  ...rest
}: HTMLAttributes<HTMLDivElement> & { children: ReactNode; className?: string }) {
  return (
    <div className={clsx('rounded-card border border-line bg-paper-card p-5 shadow-card', className)} {...rest}>
      {children}
    </div>
  );
}

export function Badge({ children, tone = 'default' }: { children: ReactNode; tone?: 'default' | 'clay' | 'gold' | 'moss' }) {
  return (
    <span
      className={clsx(
        'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium',
        tone === 'default' && 'bg-paper-dim text-ink/70',
        tone === 'clay' && 'bg-clay/15 text-clay',
        tone === 'gold' && 'bg-gold/15 text-gold',
        tone === 'moss' && 'bg-moss-100 text-moss-700',
      )}
    >
      {children}
    </span>
  );
}

export function ErrorText({ children }: { children: ReactNode }) {
  if (!children) return null;
  return <p className="rounded-card bg-clay/10 px-3 py-2 text-sm text-clay">{children}</p>;
}
