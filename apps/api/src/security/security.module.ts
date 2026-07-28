import { prisma } from "@fashion/db";
import { Module } from "@nestjs/common";
import { APP_INTERCEPTOR } from "@nestjs/core";

import { AUDIT_DB, AuditInterceptor } from "./audit.interceptor";
import {
  RATE_LIMIT_STORE,
  RateLimitGuard,
  RedisRateLimitStore,
} from "./rate-limit.guard";

@Module({
  providers: [
    AuditInterceptor,
    RateLimitGuard,
    RedisRateLimitStore,
    { provide: AUDIT_DB, useValue: prisma },
    { provide: RATE_LIMIT_STORE, useExisting: RedisRateLimitStore },
    { provide: APP_INTERCEPTOR, useExisting: AuditInterceptor },
  ],
  exports: [RATE_LIMIT_STORE, RateLimitGuard],
})
export class SecurityModule {}
