import "./instrument";
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
  // Only explicit proxy addresses are trusted; a client-supplied forwarding header is not an identity.
  const trustedProxies = process.env.TRUSTED_PROXY_ADDRESSES?.split(",").map((value) => value.trim()).filter(Boolean);
  if (trustedProxies?.length) app.set("trust proxy", trustedProxies);

  app.useBodyParser("json", { limit: "5mb" });
  app.use(cookieParser());
  await app.listen(port, "0.0.0.0");
  Logger.log(`${PLATFORM_NAME} API 正在监听端口 ${port}`, "Bootstrap");
}

void bootstrap();
