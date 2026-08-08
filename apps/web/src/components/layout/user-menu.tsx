'use client';

import { LogOut, ShieldCheck } from 'lucide-react';
import { useState } from 'react';

import { useAuth } from '@/components/auth/auth-provider';
import { Badge } from '@/components/ui/badge';

export function UserMenu() {
  const { user, signOut } = useAuth();
  const [signingOut, setSigningOut] = useState(false);

  if (!user) return null;

  const initial = user.email.charAt(0).toUpperCase();

  return (
    <div className="flex items-center gap-2">
      {user.role === 'ADMIN' ? (
        <Badge variant="default" className="hidden sm:inline-flex">
          <ShieldCheck className="size-3" aria-hidden="true" />
          Admin
        </Badge>
      ) : null}

      <span
        className="grid size-7 place-items-center rounded-full bg-primary text-xs font-semibold text-primary-foreground"
        title={user.email}
        aria-hidden="true"
      >
        {initial}
      </span>

      <button
        onClick={() => {
          setSigningOut(true);
          void signOut().finally(() => setSigningOut(false));
        }}
        disabled={signingOut}
        aria-label="Sign out"
        title="Sign out"
        className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-50"
      >
        <LogOut className="size-4" aria-hidden="true" />
      </button>
    </div>
  );
}
