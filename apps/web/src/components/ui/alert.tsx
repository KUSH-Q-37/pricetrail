import { AlertCircle, CheckCircle2, Info, TriangleAlert } from 'lucide-react';
import type { HTMLAttributes, ReactNode } from 'react';

import { cn } from '@/lib/utils';

type AlertTone = 'info' | 'success' | 'warning' | 'error';

const tones: Record<AlertTone, { wrapper: string; icon: ReactNode }> = {
  info: {
    wrapper: 'border-border bg-muted/50 text-foreground',
    icon: <Info className="size-4 shrink-0 text-muted-foreground" />,
  },
  success: {
    wrapper: 'border-success/25 bg-success/10 text-foreground',
    icon: <CheckCircle2 className="size-4 shrink-0 text-success" />,
  },
  warning: {
    wrapper: 'border-warning/30 bg-warning/10 text-foreground',
    icon: <TriangleAlert className="size-4 shrink-0 text-warning" />,
  },
  error: {
    wrapper: 'border-destructive/25 bg-destructive/10 text-foreground',
    icon: <AlertCircle className="size-4 shrink-0 text-destructive" />,
  },
};

export interface AlertProps extends HTMLAttributes<HTMLDivElement> {
  tone?: AlertTone;
  title?: string;
}

export function Alert({
  className,
  tone = 'info',
  title,
  children,
  ...props
}: AlertProps) {
  const { wrapper, icon } = tones[tone];

  return (
    <div
      // `alert` interrupts a screen reader immediately, which is right for a
      // failure but rude for an informational note.
      role={tone === 'error' ? 'alert' : 'status'}
      className={cn('flex gap-3 rounded-lg border p-4 text-sm', wrapper, className)}
      {...props}
    >
      <span className="mt-0.5">{icon}</span>
      <div className="min-w-0 flex-1 space-y-1">
        {title ? <p className="font-medium leading-none">{title}</p> : null}
        {children ? (
          <div className="text-muted-foreground [&_p]:leading-relaxed">{children}</div>
        ) : null}
      </div>
    </div>
  );
}
