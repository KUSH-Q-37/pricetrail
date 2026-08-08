'use client';

import { motion } from 'framer-motion';
import { Package } from 'lucide-react';

import { AddProductDialog } from '@/components/products/add-product-dialog';
import { ProductCard } from '@/components/products/product-card';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/empty-state';
import { ErrorState } from '@/components/ui/error-state';
import { Skeleton } from '@/components/ui/skeleton';
import { useProducts } from '@/hooks/use-products';

export default function ProductsPage() {
  const { data, isPending, isError, error, refetch } = useProducts();

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl font-semibold tracking-tight">Products</h1>
          <p className="text-sm text-muted-foreground">
            Everything you are tracking, across both marketplaces.
          </p>
        </div>
        <AddProductDialog />
      </div>

      {/* Four states, each rendered distinctly: loading, error, empty, and
          populated. Collapsing empty into loading is how a new user ends up
          staring at a spinner that never resolves. */}
      {isPending ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" aria-busy="true">
          <span className="sr-only">Loading your products…</span>
          {Array.from({ length: 6 }).map((_, index) => (
            <Skeleton key={index} className="h-44 rounded-xl" />
          ))}
        </div>
      ) : isError ? (
        <ErrorState error={error} onRetry={() => refetch()} />
      ) : data.items.length === 0 ? (
        <EmptyState
          icon={Package}
          title="No products tracked yet"
          description="Paste an Amazon or Flipkart product URL to start recording its price every day."
          action={<AddProductDialog />}
        />
      ) : (
        <>
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-medium text-muted-foreground">Tracked</h2>
            <Badge variant="secondary">{data.total}</Badge>
          </div>

          <motion.div
            initial="initial"
            animate="animate"
            variants={{ animate: { transition: { staggerChildren: 0.04 } } }}
            className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3"
          >
            {data.items.map((product) => (
              <motion.div
                key={product.id}
                variants={{
                  initial: { opacity: 0, y: 8 },
                  animate: { opacity: 1, y: 0 },
                }}
              >
                <ProductCard product={product} />
              </motion.div>
            ))}
          </motion.div>
        </>
      )}
    </div>
  );
}
