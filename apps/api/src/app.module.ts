import { Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";

import { HealthController } from "./health.controller";
import { AuthGuard } from "./modules/auth/auth.guard";
import { AuthModule } from "./modules/auth/auth.module";

@Module({
  imports: [AuthModule],
  controllers: [HealthController],
  providers: [
    {
      provide: APP_GUARD,
      useClass: AuthGuard,
    },
  ],
})
export class AppModule {}
