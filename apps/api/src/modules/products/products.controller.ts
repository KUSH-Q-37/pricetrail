import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';

import { zodPipe } from '../../common/pipes/zod-validation.pipe';
import { RateLimit } from '../../common/rate-limit/rate-limit.decorator';
import {
  IngestProductSchema,
  ListProductsSchema,
  type IngestProductRequest,
  type ListProductsQuery,
} from './product.schemas';
import { ProductsService } from './products.service';

/**
 * Public product routes.
 *
 * There is no sign-in and no per-user state: every product the system knows
 * about is visible to everyone, and searching a URL is what enrols it in daily
 * tracking. The endpoints that existed to manage one person's list — set a
 * notification threshold, stop tracking — went with the accounts they belonged
 * to. Nothing here is scoped to a caller any more.
 */
@ApiTags('products')
@Controller({ path: 'products', version: '1' })
export class ProductsController {
  constructor(private readonly products: ProductsService) {}

  @Get()
  @ApiOperation({ summary: 'List tracked products' })
  list(@Query(zodPipe(ListProductsSchema)) query: ListProductsQuery) {
    return this.products.list(query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'One product with its marketplace listings' })
  @ApiResponse({ status: 404, description: 'No such product' })
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.products.findById(id);
  }

  /**
   * Search by URL. The only way a product enters the system.
   *
   * Rate-limited far more tightly than reads, and that gap matters more now
   * than it used to. Each new URL enrols a product in daily fetching
   * indefinitely, so this endpoint spends a recurring budget where reads spend
   * nothing — and with no sign-in, this limit is the only thing between the
   * internet and an unbounded fetch bill.
   */
  @Post('ingest')
  @RateLimit({ windowSeconds: 60, maxRequests: 10 })
  @ApiOperation({
    summary: 'Search an Amazon or Flipkart URL; daily tracking starts automatically',
  })
  @ApiResponse({ status: 201, description: 'Found (created, or already known)' })
  @ApiResponse({ status: 400, description: 'URL could not be parsed' })
  ingest(@Body(zodPipe(IngestProductSchema)) body: IngestProductRequest) {
    return this.products.ingestByUrl(body.url);
  }
}
