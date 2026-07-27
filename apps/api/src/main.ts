import "./load-env";
import "reflect-metadata";

import { PLATFORM_NAME } from "@fashion/shared";
import { Logger } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import cookieParser from "cookie-parser";

import { AppModule } from "./app.module";

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bodyParser: false,
  });
  const port = Number(process.env.API_PORT ?? 3001);

  app.useBodyParser("json", { limit: "5mb" });
  app.use(cookieParser());
  await app.listen(port, "0.0.0.0");
  Logger.log(`${PLATFORM_NAME} API 正在监听端口 ${port}`, "Bootstrap");
}

void bootstrap();
