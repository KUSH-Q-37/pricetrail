import { Controller, Get, NotFoundException, Param } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { AppConfigService } from '../../config/app-config.service';

/**
 * Service metadata for clients.
 *
 * Real endpoint, not a placeholder: the frontend reads `apiVersion` to decide
 * whether it needs to prompt for a refresh, and `timezone` to label chart axes
 * consistently with how the backend bucketed the days.
 *
 * It is also the first rate-limited, versioned route, which makes it the
 * smoke-test surface for the whole foundation.
 */
@ApiTags('meta')
// Version and timezone are needed by the login screen itself, before any
// session exists. Nothing here is user-specific.
@Controller({ path: 'meta', version: '1' })
export class MetaController {
  constructor(private readonly config: AppConfigService) {}

  @Get()
  @ApiOperation({ summary: 'API version and runtime metadata' })
  get(): {
    apiVersion: string;
    environment: string;
    timezone: string;
    serverTime: string;
  } {
    return {
      apiVersion: '1',
      environment: this.config.nodeEnv,
      timezone: this.config.appTimezone,
      serverTime: new Date().toISOString(),
    };
  }

  /**
   * Deliberate error surface used to verify the RFC 7807 envelope end to end.
   * Kept because an error contract that is never exercised drifts silently.
   */
  @Get('echo-error/:kind')
  @ApiOperation({ summary: 'Raise a known error, for verifying the error envelope' })
  echoError(@Param('kind') kind: string): never {
    if (kind === 'not-found') {
      throw new NotFoundException('Demo resource does not exist');
    }
    throw new Error('Deliberate unhandled error for envelope verification');
  }
}
