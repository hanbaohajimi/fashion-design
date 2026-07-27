import type { HealthResponse } from "@fashion/shared";
import { Controller, Get } from "@nestjs/common";

import { Public } from "./modules/auth/public.decorator";

@Controller("health")
export class HealthController {
  @Public()
  @Get()
  getHealth(): HealthResponse {
    return {
      ok: true,
      ts: new Date().toISOString(),
    };
  }
}
