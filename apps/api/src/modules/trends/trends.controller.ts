import {
  Controller,
  Get,
  Header,
  Inject,
  Query,
} from "@nestjs/common";
import { TrendsService } from "./trends.service";

const CACHE_CONTROL_PUBLIC = "public, max-age=300, stale-while-revalidate=600";

@Controller("trends")
export class TrendsController {
  constructor(
    @Inject(TrendsService) private readonly trendsService: TrendsService,
  ) {}

  @Get()
  @Header("Cache-Control", CACHE_CONTROL_PUBLIC)
  async listTrends(
    @Query("limit") limit?: string,
    @Query("page") page?: string,
  ) {
    const parsedLimit = limit ? Number.parseInt(limit, 10) : 60;
    const parsedPage = page ? Number.parseInt(page, 10) : 1;

    return this.trendsService.listTrends(parsedLimit, parsedPage);
  }

  @Get("digest/current")
  @Header("Cache-Control", CACHE_CONTROL_PUBLIC)
  async getCurrentDigest() {
    return this.trendsService.getCurrentDigest();
  }
}
