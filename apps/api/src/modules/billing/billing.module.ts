import { prisma } from "@fashion/db";
import { Global, Module } from "@nestjs/common";

import { BillingService } from "./billing.service";

@Global()
@Module({
  providers: [
    {
      provide: BillingService,
      useFactory: () => new BillingService(prisma),
    },
  ],
  exports: [BillingService],
})
export class BillingModule {}
