import { Module } from "@nestjs/common";

import { AuthController } from "./auth.controller";
import { AuthService } from "./auth.service";
import { SupabaseAuthGateway } from "./supabase-auth.gateway";

@Module({
  controllers: [AuthController],
  providers: [AuthService, SupabaseAuthGateway],
  exports: [AuthService],
})
export class AuthModule {}
