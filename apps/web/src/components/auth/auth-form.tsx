'use client';

import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useState, type FormEvent } from 'react';

import { useAuth } from '@/components/auth/auth-provider';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { AUTH_MODE } from '@/lib/auth';
import { safeRedirectPath } from '@/lib/safe-redirect';

interface AuthFormProps {
  mode: 'signin' | 'signup';
  /**
   * Post-login destination, resolved by the server component from
   * `searchParams`. Passed as a prop rather than read with useSearchParams():
   * that hook opts the entire subtree into client-only rendering, so the
   * static HTML would contain only a skeleton and the form would appear on
   * hydration.
   */
  next?: string;
}

export function AuthForm({ mode, next }: AuthFormProps) {
  const { signIn, signUp } = useAuth();
  const router = useRouter();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const isSignUp = mode === 'signup';

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);

    try {
      if (isSignUp) {
        await signUp(email, password);
      } else {
        await signIn(email, password);
      }

      // Only same-origin paths are honoured — an unvalidated `next` is an
      // open redirect. See safe-redirect.ts for why this is URL parsing and
      // not a prefix check.
      router.replace(safeRedirectPath(next));
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : 'Could not sign you in.',
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{isSignUp ? 'Create your account' : 'Sign in'}</CardTitle>
        <CardDescription>
          {isSignUp
            ? 'Start tracking prices across Amazon and Flipkart.'
            : 'Welcome back.'}
        </CardDescription>
      </CardHeader>

      <CardContent>
        {AUTH_MODE === 'local-dev' ? (
          <Alert tone="warning" title="Development mode" className="mb-4">
            <p>
              The API is running with <code>AUTH_MODE=local-dev</code>. Any email
              signs in and <strong>the password is not checked</strong>. Use{' '}
              <code>admin@pricetrail.local</code> for the admin role.
            </p>
          </Alert>
        ) : null}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <label htmlFor="email" className="text-sm font-medium">
              Email
            </label>
            <input
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:border-ring"
            />
          </div>

          <div className="space-y-1.5">
            <label htmlFor="password" className="text-sm font-medium">
              Password
            </label>
            <input
              id="password"
              name="password"
              type="password"
              autoComplete={isSignUp ? 'new-password' : 'current-password'}
              required={AUTH_MODE !== 'local-dev'}
              minLength={AUTH_MODE === 'local-dev' ? 0 : 8}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:border-ring"
            />
          </div>

          {error ? (
            <Alert tone="error">
              <p>{error}</p>
            </Alert>
          ) : null}

          <Button type="submit" className="w-full" loading={submitting}>
            {isSignUp ? 'Create account' : 'Sign in'}
          </Button>
        </form>

        <p className="mt-4 text-center text-sm text-muted-foreground">
          {isSignUp ? 'Already have an account? ' : "Don't have an account? "}
          <Link
            href={isSignUp ? '/login' : '/signup'}
            className="text-primary underline-offset-4 hover:underline"
          >
            {isSignUp ? 'Sign in' : 'Sign up'}
          </Link>
        </p>
      </CardContent>
    </Card>
  );
}
