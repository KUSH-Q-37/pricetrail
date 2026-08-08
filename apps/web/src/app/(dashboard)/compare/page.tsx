'use client';

import { LineChart } from 'lucide-react';
import { useEffect, useState } from 'react';

import { PriceHistoryPanel } from '@/components/charts/price-history-panel';
import { EmptyState } from '@/components/ui/empty-state';
import { ErrorState } from '@/components/ui/error-state';
import { Skeleton } from '@/components/ui/skeleton';
import { useProducts } from '@/hooks/use-products';
import { cn } from '@/lib/utils';

export default function ComparePage() {
  const { data, isPending, isError, error, refetch } = useProducts(1, 50);
  const [selected, setSelected] = useState<string | null>(null);

  // Default to the first product once loaded, without stomping a user choice.
  useEffect(() => {
    if (!selected && data?.items[0]) setSelected(data.items[0].id);
  }, [data, selected]);

  const ready = data?.items.filter((product) => product.status === 'READY') ?? [];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Compare</h1>
        <p className="text-sm text-muted-foreground">
          Amazon versus Flipkart price movement over time.
        </p>
      </div>

      {isPending ? (
        <div className="space-y-4" aria-busy="true">
          <Skeleton className="h-9 w-full max-w-md" />
          <Skeleton className="h-[420px] rounded-xl" />
        </div>
      ) : isError ? (
        <ErrorState error={error} onRetry={() => refetch()} />
      ) : ready.length === 0 ? (
        <EmptyState
          icon={LineChart}
          title="Nothing to compare yet"
          description="Track a product and let the daily tracker record a few observations. Charts appear as soon as there is history on both marketplaces."
        />
      ) : (
        <>
          {/* One filter row above everything it scopes. */}
          <div
            role="radiogroup"
            aria-label="Product"
            className="flex flex-wrap gap-2"
          >
            {ready.map((product) => (
              <button
                key={product.id}
                role="radio"
                aria-checked={selected === product.id}
                onClick={() => setSelected(product.id)}
                className={cn(
                  'max-w-xs truncate rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors',
                  selected === product.id
                    ? 'border-primary/40 bg-primary/10 text-foreground'
                    : 'border-border text-muted-foreground hover:text-foreground',
                )}
                title={product.title}
              >
                {product.title}
              </button>
            ))}
          </div>

          {selected ? <PriceHistoryPanel productId={selected} /> : null}
        </>
      )}
    </div>
  );
}
