import type { HTMLAttributes } from 'react';

import { cn } from '@/lib/utils';

type BadgeVariant =
  | 'default'
  | 'secondary'
  | 'outline'
  | 'success'
  | 'warning'
  | 'destructive'
  | 'amazon'
  | 'flipkart';

const variants: Record<BadgeVariant, string> = {
  default: 'bg-primary/10 text-primary border-primary/20',
  secondary: 'bg-secondary text-secondary-foreground border-transparent',
  outline: 'bg-transparent text-foreground border-border',
  success: 'bg-success/10 text-success border-success/20',
  warning: 'bg-warning/15 text-warning border-warning/25',
  destructive: 'bg-destructive/10 text-destructive border-destructive/20',
  amazon: 'bg-amazon/15 text-amazon border-amazon/30',
  flipkart: 'bg-flipkart/15 text-flipkart border-flipkart/30',
};

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  variant?: BadgeVariant;
}

export function Badge({ className, variant = 'default', ...props }: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full border px-2 py-0.5',
        'text-xs font-medium',
        variants[variant],
        className,
      )}
      {...props}
    />
  );
}
