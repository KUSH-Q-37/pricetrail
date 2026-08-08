import { Controller, Get, Header, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { zodPipe } from '../../common/pipes/zod-validation.pipe';
import type { AuthenticatedUser } from '../auth/auth.service';
import { CurrentUser } from '../auth/decorators';
import { HistoryQuerySchema, type HistoryQuery } from './price.schemas';
import { PricesService } from './prices.service';

@ApiTags('prices')
@ApiBearerAuth()
@Controller({ path: 'products', version: '1' })
export class PricesController {
  constructor(private readonly prices: PricesService) {}

  @Get(':id/history')
  // Prices change once a day, so a short private cache costs nothing and
  // removes a round trip every time the user toggles between ranges.
  @Header('Cache-Control', 'private, max-age=300')
  @ApiOperation({ summary: 'Daily price history for one product, per marketplace' })
  history(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Query(zodPipe(HistoryQuerySchema)) query: HistoryQuery,
  ) {
    return this.prices.getHistory(user, id, query.range, query.platforms);
  }
}
