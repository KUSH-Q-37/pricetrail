'use client';

import { AnimatePresence, motion } from 'framer-motion';
import { Link2, Plus, X } from 'lucide-react';
import { useEffect, useRef, useState, type FormEvent } from 'react';

import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { useIngestProduct } from '@/hooks/use-products';
import { ApiError } from '@/lib/api-client';

export function AddProductDialog() {
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const ingest = useIngestProduct();

  // Focus the field when the dialog opens; a modal that requires a click to
  // start typing is a small tax paid on every single use.
  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  function close() {
    setOpen(false);
    setUrl('');
    ingest.reset();
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!url.trim()) return;

    ingest.mutate(url.trim(), {
      onSuccess: () => close(),
      // Failure deliberately leaves the dialog open with the URL intact, so a
      // typo can be corrected instead of retyped.
    });
  }

  const error = ingest.error;
  const message =
    error instanceof ApiError ? error.userMessage : error ? String(error) : null;
  const isQuota = error instanceof ApiError && error.code === 'QUOTA_EXCEEDED';

  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <Plus className="size-4" aria-hidden="true" />
        Track a product
      </Button>

      <AnimatePresence>
        {open ? (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={close}
              className="fixed inset-0 z-50 bg-black/50 backdrop-blur-[2px]"
              aria-hidden="true"
            />
            <div className="fixed inset-0 z-50 grid place-items-center p-4">
              <motion.div
                initial={{ opacity: 0, scale: 0.97, y: 8 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.97, y: 8 }}
                transition={{ duration: 0.15 }}
                role="dialog"
                aria-modal="true"
                aria-labelledby="add-product-title"
                className="w-full max-w-lg rounded-xl border border-border bg-card shadow-lg"
              >
                <div className="flex items-center justify-between border-b border-border p-5">
                  <h2 id="add-product-title" className="font-semibold">
                    Track a product
                  </h2>
                  <button
                    onClick={close}
                    aria-label="Close"
                    className="rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
                  >
                    <X className="size-4" aria-hidden="true" />
                  </button>
                </div>

                <form onSubmit={handleSubmit} className="space-y-4 p-5">
                  <div className="space-y-1.5">
                    <label htmlFor="product-url" className="text-sm font-medium">
                      Product URL
                    </label>
                    <div className="relative">
                      <Link2
                        className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
                        aria-hidden="true"
                      />
                      <input
                        ref={inputRef}
                        id="product-url"
                        type="text"
                        inputMode="url"
                        value={url}
                        onChange={(event) => setUrl(event.target.value)}
                        placeholder="https://www.amazon.in/dp/B0CHX1W1XY"
                        aria-describedby="product-url-help"
                        className="h-10 w-full rounded-md border border-input bg-background pl-9 pr-3 text-sm placeholder:text-muted-foreground focus-visible:border-ring"
                      />
                    </div>
                    <p id="product-url-help" className="text-xs text-muted-foreground">
                      Paste any amazon.in or flipkart.com product link. We will
                      find the matching listing on the other marketplace.
                    </p>
                  </div>

                  {message ? (
                    <Alert tone={isQuota ? 'warning' : 'error'}>
                      <p>{message}</p>
                    </Alert>
                  ) : null}

                  <div className="flex justify-end gap-2">
                    <Button type="button" variant="ghost" onClick={close}>
                      Cancel
                    </Button>
                    <Button type="submit" loading={ingest.isPending} disabled={!url.trim()}>
                      Start tracking
                    </Button>
                  </div>
                </form>
              </motion.div>
            </div>
          </>
        ) : null}
      </AnimatePresence>
    </>
  );
}
