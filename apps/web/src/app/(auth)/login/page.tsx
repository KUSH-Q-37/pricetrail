import { AuthForm } from '@/components/auth/auth-form';

export const metadata = { title: 'Sign in' };

/**
 * Server component. Reading `searchParams` here (rather than useSearchParams
 * in the client form) keeps the form itself server-rendered — it is present in
 * the initial HTML instead of appearing after hydration.
 *
 * In Next 15+ `searchParams` is a Promise and must be awaited.
 */
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;
  return <AuthForm mode="signin" next={next} />;
}
