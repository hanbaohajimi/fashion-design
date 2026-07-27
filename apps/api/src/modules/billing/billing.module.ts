import { prisma } from "@fashion/db";
import { Global, Module } from "@nestjs/common";

import { BILLING_DB, BillingService } from "./billing.service";

@Global()
@Module({
  providers: [
    BillingService,
    {
      provide: BILLING_DB,
      useValue: prisma,
    },
  ],
  exports: [BillingService],
})
export class BillingModule {}
