'use client';

import { ExternalLink, Loader2, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import type { Product } from '@/hooks/use-products';
import { formatPrice, formatRelativeTime } from '@/lib/utils';

function PlatformRow({ listing }: { listing: Product['listings'][number] }) {
  const isAmazon = listing.platform === 'AMAZON';

  return (
    <div className="flex items-center justify-between gap-3 py-1.5">
      <Badge variant={isAmazon ? 'amazon' : 'flipkart'}>
        {isAmazon ? 'Amazon' : 'Flipkart'}
      </Badge>

      <div className="flex items-center gap-2 text-sm">
        {listing.currentPriceMinor === null ? (
          <span className="text-muted-foreground">No price yet</span>
        ) : (
          <>
            <span className="font-semibold tabular-price">
              {formatPrice(listing.currentPriceMinor, listing.currency)}
            </span>
            {listing.discountPercent ? (
              <Badge variant="success">-{listing.discountPercent}%</Badge>
            ) : null}
          </>
        )}
        <a
          href={listing.url}
          target="_blank"
          // noreferrer is the important half: without it the opened page can
          // reach back through window.opener.
          rel="noopener noreferrer"
          aria-label={`Open on ${isAmazon ? 'Amazon' : 'Flipkart'}`}
          className="text-muted-foreground hover:text-foreground"
        >
          <ExternalLink className="size-3.5" aria-hidden="true" />
        </a>
      </div>
    </div>
  );
}

export function ProductCard({ product }: { product: Product }) {

  const isPending = product.status === 'PENDING';

  return (
    <Card className="flex flex-col p-4 transition-colors hover:border-primary/40">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <Link
            href={`/products/${product.id}`}
            className="line-clamp-2 font-medium leading-snug hover:underline"
          >
            {product.title}
          </Link>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            {isPending ? (
              <Badge variant="warning">
                <Loader2 className="size-3 animate-spin" aria-hidden="true" />
                Fetching details
              </Badge>
            ) : null}
            {product.brand ? <Badge variant="outline">{product.brand}</Badge> : null}
          </div>
        </div>

      </div>

      <div className="divide-y divide-border border-t border-border pt-1">
        {product.listings.map((listing) => (
          <PlatformRow key={listing.id} listing={listing} />
        ))}
      </div>

      {isPending ? (
        <p className="mt-3 text-xs text-muted-foreground">
          Price tracking begins once the marketplace fetcher runs.
        </p>
      ) : product.listings[0]?.lastSuccessAt ? (
        <p className="mt-3 text-xs text-muted-foreground">
          Checked {formatRelativeTime(product.listings[0].lastSuccessAt)}
        </p>
      ) : null}
    </Card>
  );
}
