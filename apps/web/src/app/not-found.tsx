import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-4 p-6 text-center">
      <p className="text-5xl font-semibold tracking-tight text-muted-foreground">404</p>
      <h1 className="text-xl font-semibold">This page does not exist</h1>
      <p className="max-w-sm text-sm text-muted-foreground">
        The link may be broken, or the product may no longer be tracked.
      </p>
      {/*
        Styled as a button rather than wrapped in <Button>: rendering an <a>
        inside a <button> is invalid HTML and breaks keyboard activation.
      */}
      <Link
        href="/"
        className="inline-flex h-9 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground shadow-sm transition-colors hover:bg-primary/90"
      >
        Back to dashboard
      </Link>
    </div>
  );
}
