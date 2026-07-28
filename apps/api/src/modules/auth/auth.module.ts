import { Module } from "@nestjs/common";

import { SecurityModule } from "../../security/security.module";
import { AuthController } from "./auth.controller";
import { AuthService } from "./auth.service";
import { SupabaseAuthGateway } from "./supabase-auth.gateway";

@Module({
  imports: [SecurityModule],
  controllers: [AuthController],
  providers: [AuthService, SupabaseAuthGateway],
  exports: [AuthService],
})
export class AuthModule {}
