import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';

import { zodPipe } from '../../common/pipes/zod-validation.pipe';
import { RateLimit } from '../../common/rate-limit/rate-limit.decorator';
import type { AuthenticatedUser } from '../auth/auth.service';
import { CurrentUser } from '../auth/decorators';
import {
  IngestProductSchema,
  ListProductsSchema,
  UpdateTrackingSchema,
  type IngestProductRequest,
  type ListProductsQuery,
  type UpdateTrackingRequest,
} from './product.schemas';
import { ProductsService } from './products.service';

@ApiTags('products')
@ApiBearerAuth()
@Controller({ path: 'products', version: '1' })
export class ProductsController {
  constructor(private readonly products: ProductsService) {}

  @Get()
  @ApiOperation({ summary: 'List the products this user tracks' })
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query(zodPipe(ListProductsSchema)) query: ListProductsQuery,
  ) {
    return this.products.list(user, query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'One tracked product with its listings' })
  @ApiResponse({ status: 404, description: 'Not tracked by this user' })
  findOne(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.products.findById(user, id);
  }

  /**
   * Ingest by URL.
   *
   * Rate-limited far more tightly than reads: each new URL eventually triggers
   * a marketplace fetch, so this endpoint spends a budget that reads do not.
   * Sharing the global 120/min allowance would let one client queue two hours
   * of scraping in a minute.
   */
  @Post('ingest')
  @RateLimit({ windowSeconds: 60, maxRequests: 10 })
  @ApiOperation({ summary: 'Track a product from an Amazon or Flipkart URL' })
  @ApiResponse({ status: 201, description: 'Tracked (created or already existing)' })
  @ApiResponse({ status: 400, description: 'URL could not be parsed' })
  @ApiResponse({ status: 403, description: 'Tracking quota reached' })
  ingest(
    @CurrentUser() user: AuthenticatedUser,
    @Body(zodPipe(IngestProductSchema)) body: IngestProductRequest,
  ) {
    return this.products.ingestByUrl(user, body.url);
  }

  @Patch(':id/tracking')
  @ApiOperation({ summary: 'Set the price-drop notification threshold' })
  updateTracking(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodPipe(UpdateTrackingSchema)) body: UpdateTrackingRequest,
  ) {
    return this.products.setNotifyThreshold(user, id, body.notifyBelowMinor ?? null);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Stop tracking (price history is retained)' })
  async untrack(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    await this.products.untrack(user, id);
  }
}
