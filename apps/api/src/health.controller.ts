import type { HealthResponse } from "@fashion/shared";
import { Controller, Get } from "@nestjs/common";

@Controller("health")
export class HealthController {
  @Get()
  getHealth(): HealthResponse {
    return {
      ok: true,
      ts: new Date().toISOString(),
    };
  }
}
