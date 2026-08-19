'use client';

import { ArrowLeft, ExternalLink, Loader2 } from 'lucide-react';
import Link from 'next/link';
import { use } from 'react';

import { PriceHistoryPanel } from '@/components/charts/price-history-panel';
import { Badge } from '@/components/ui/badge';
import { Alert } from '@/components/ui/alert';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ErrorState } from '@/components/ui/error-state';
import { Skeleton } from '@/components/ui/skeleton';
import { useProduct } from '@/hooks/use-products';
import { formatPrice, formatRelativeTime } from '@/lib/utils';

export default function ProductDetailPage({
  params,
}: {
  // Next 15+ delivers route params as a Promise; `use()` unwraps it in a
  // client component.
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const { data, isPending, isError, error, refetch } = useProduct(id);

  return (
    <div className="space-y-6">
      {/* Back to the search box, not to a list — there is no list. */}
      <Link
        href="/dashboard"
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
        Search another product
      </Link>

      {isPending ? (
        <div className="space-y-4" aria-busy="true">
          <span className="sr-only">Loading product…</span>
          <Skeleton className="h-9 w-2/3" />
          <div className="grid gap-4 sm:grid-cols-2">
            <Skeleton className="h-40 rounded-xl" />
            <Skeleton className="h-40 rounded-xl" />
          </div>
        </div>
      ) : isError ? (
        <ErrorState error={error} onRetry={() => refetch()} />
      ) : (
        <>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">{data.title}</h1>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              {data.brand ? <Badge variant="outline">{data.brand}</Badge> : null}
              <Badge variant="secondary">{data.category}</Badge>
              {data.status === 'PENDING' ? (
                <Badge variant="warning">
                  <Loader2 className="size-3 animate-spin" aria-hidden="true" />
                  Fetching details
                </Badge>
              ) : null}
            </div>
          </div>

          {data.status === 'PENDING' ? (
            <Alert tone="info" title="Waiting on marketplace data">
              <p>
                This product was accepted and queued. Titles, prices and
                specifications appear once the marketplace fetchers land in
                Phase 7 and 8 — this page refreshes itself automatically.
              </p>
            </Alert>
          ) : null}

          <div className="grid gap-4 sm:grid-cols-2">
            {data.listings.map((listing) => {
              const isAmazon = listing.platform === 'AMAZON';
              return (
                <Card key={listing.id}>
                  <CardHeader className="flex-row items-center justify-between space-y-0">
                    <CardTitle className="text-base">
                      <Badge variant={isAmazon ? 'amazon' : 'flipkart'}>
                        {isAmazon ? 'Amazon' : 'Flipkart'}
                      </Badge>
                    </CardTitle>
                    <a
                      href={listing.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                    >
                      View listing
                      <ExternalLink className="size-3" aria-hidden="true" />
                    </a>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div>
                      {listing.currentPriceMinor === null ? (
                        <p className="text-sm text-muted-foreground">
                          No price recorded yet
                        </p>
                      ) : (
                        <div className="flex items-baseline gap-2">
                          <span className="text-2xl font-semibold tabular-price">
                            {formatPrice(listing.currentPriceMinor, listing.currency)}
                          </span>
                          {listing.mrpMinor &&
                          listing.mrpMinor > listing.currentPriceMinor ? (
                            <span className="text-sm text-muted-foreground line-through tabular-price">
                              {formatPrice(listing.mrpMinor, listing.currency)}
                            </span>
                          ) : null}
                        </div>
                      )}
                    </div>

                    <dl className="grid grid-cols-2 gap-2 text-xs">
                      <div>
                        <dt className="text-muted-foreground">Identifier</dt>
                        <dd className="font-mono">{listing.externalId}</dd>
                      </div>
                      <div>
                        <dt className="text-muted-foreground">Availability</dt>
                        <dd>{listing.availability.replace(/_/g, ' ').toLowerCase()}</dd>
                      </div>
                      <div>
                        <dt className="text-muted-foreground">Seller</dt>
                        <dd>{listing.sellerName ?? '—'}</dd>
                      </div>
                      <div>
                        <dt className="text-muted-foreground">Last checked</dt>
                        <dd>
                          {listing.lastSuccessAt
                            ? formatRelativeTime(listing.lastSuccessAt)
                            : 'never'}
                        </dd>
                      </div>
                    </dl>

                    {listing.consecutiveFailures > 0 ? (
                      <Alert tone="warning">
                        <p>
                          {listing.consecutiveFailures} consecutive fetch
                          failure(s). Tracking pauses automatically at 5.
                        </p>
                      </Alert>
                    ) : null}
                  </CardContent>
                </Card>
              );
            })}
          </div>

          <PriceHistoryPanel productId={id} />
        </>
      )}
    </div>
  );
}
