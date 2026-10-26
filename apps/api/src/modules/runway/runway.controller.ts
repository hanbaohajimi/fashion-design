import {
  Body,
  Controller,
  Get,
  Header,
  Headers,
  Inject,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Res,
} from "@nestjs/common";
import type { Request, Response } from "express";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { CurrentUser } from "../auth/current-user.decorator";
import type { AuthenticatedUser } from "../auth/auth.types";
import { RunwayService } from "./runway.service";
import { RunwayStorage } from "./runway-storage.service";

export function normalizedRange(
  raw: string | undefined,
  size: number,
): string | null | undefined {
  if (!raw) return undefined;
  const match = /^bytes=(\d*)-(\d*)$/.exec(raw);
  if (!match || (!match[1] && !match[2]) || size < 1) return null;
  let start: number;
  let end: number;
  if (!match[1]) {
    const suffix = Number(match[2]);
    if (!Number.isSafeInteger(suffix) || suffix < 1) return null;
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(match[1]);
    end = match[2] ? Number(match[2]) : size - 1;
  }
  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(end) ||
    start >= size ||
    start < 0 ||
    end < start
  )
    return null;
  return `bytes=${start}-${Math.min(end, size - 1)}`;
}

@Controller("projects/:projectId/runway")
export class RunwayController {
  constructor(
    @Inject(RunwayService) private readonly runway: RunwayService,
    @Inject(RunwayStorage) private readonly storage: RunwayStorage,
  ) {}
  @Get("capabilities")
  @Header("Cache-Control", "private, no-store")
  capabilities(
    @CurrentUser() user: AuthenticatedUser,
    @Param("projectId") project: string,
  ) {
    return this.runway.capabilities(user.userId, project);
  }
  @Get("shows")
  @Header("Cache-Control", "private, no-store")
  shows(
    @CurrentUser() user: AuthenticatedUser,
    @Param("projectId") project: string,
  ) {
    return this.runway.list(user.userId, project);
  }
  @Post("shows")
  @Header("Cache-Control", "private, no-store")
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Param("projectId") project: string,
    @Body() body: unknown,
  ) {
    return this.runway.create(user.userId, project, body);
  }
  @Get("shows/:showId")
  @Header("Cache-Control", "private, no-store")
  show(
    @CurrentUser() user: AuthenticatedUser,
    @Param("projectId") project: string,
    @Param("showId") id: string,
  ) {
    return this.runway.show(user.userId, project, id);
  }
  @Patch("shows/:showId")
  @Header("Cache-Control", "private, no-store")
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param("projectId") project: string,
    @Param("showId") id: string,
    @Body() body: unknown,
  ) {
    return this.runway.update(user.userId, project, id, body);
  }
  @Post("shows/:showId/runs")
  @Header("Cache-Control", "private, no-store")
  start(
    @CurrentUser() user: AuthenticatedUser,
    @Param("projectId") project: string,
    @Param("showId") id: string,
    @Body() body: unknown,
  ) {
    return this.runway.start(user.userId, project, id, body);
  }
  @Get("runs/:runId")
  @Header("Cache-Control", "private, no-store")
  run(
    @CurrentUser() user: AuthenticatedUser,
    @Param("projectId") project: string,
    @Param("runId") id: string,
  ) {
    return this.runway.run(user.userId, project, id);
  }
  @Post("runs/:runId/actions")
  @Header("Cache-Control", "private, no-store")
  action(
    @CurrentUser() user: AuthenticatedUser,
    @Param("projectId") project: string,
    @Param("runId") id: string,
    @Body() body: unknown,
  ) {
    return this.runway.action(user.userId, project, id, body);
  }
  @Post("runs/:runId/forks")
  @Header("Cache-Control", "private, no-store")
  fork(
    @CurrentUser() user: AuthenticatedUser,
    @Param("projectId") project: string,
    @Param("runId") id: string,
    @Body() body: unknown,
  ) {
    return this.runway.fork(user.userId, project, id, body);
  }
  @Post("runs/:runId/cancel")
  @Header("Cache-Control", "private, no-store")
  cancel(
    @CurrentUser() user: AuthenticatedUser,
    @Param("projectId") project: string,
    @Param("runId") id: string,
    @Body() body: unknown,
  ) {
    return this.runway.cancel(user.userId, project, id, body);
  }
  @Get("runs/:runId/events")
  async events(
    @CurrentUser() user: AuthenticatedUser,
    @Param("projectId") project: string,
    @Param("runId") id: string,
    @Headers("last-event-id") lastEventId: string | undefined,
    @Query("after") after: string | undefined,
    @Req() request: Request,
    @Res() response: Response,
  ) {
    let cursor = Number(lastEventId ?? after ?? 0);
    if (!Number.isSafeInteger(cursor) || cursor < 0) cursor = 0;
    const initial = await this.runway.events(user.userId, project, id, cursor);
    response.set({
      "Content-Type": "text/event-stream",
      "Cache-Control": "private, no-store",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    response.flushHeaders();
    let closed = false;
    let polling = false;
    const write = (events: Awaited<ReturnType<RunwayService["events"]>>) => {
      for (const event of events) {
        response.write(
          `id: ${event.sequence}\nevent: runway\ndata: ${JSON.stringify(event)}\n\n`,
        );
        cursor = event.sequence;
      }
    };
    write(initial);
    const poll = setInterval(() => {
      if (closed || polling) return;
      polling = true;
      void this.runway
        .events(user.userId, project, id, cursor)
        .then((events) => {
          if (!closed) write(events);
        })
        .catch(() => {
          response.end();
          cleanup();
        })
        .finally(() => {
          polling = false;
        });
    }, 1000);
    const heartbeat = setInterval(() => {
      if (!closed) response.write(": heartbeat\n\n");
    }, 15_000);
    const cleanup = () => {
      closed = true;
      clearInterval(poll);
      clearInterval(heartbeat);
    };
    request.on("aborted", cleanup);
    response.on("close", cleanup);
  }
  @Get("media/:mediaId/content")
  async content(
    @CurrentUser() user: AuthenticatedUser,
    @Param("projectId") project: string,
    @Param("mediaId") id: string,
    @Headers("range") rawRange: string | undefined,
    @Query("download") download: string | undefined,
    @Res() response: Response,
  ) {
    const media = await this.runway.media(user.userId, project, id);
    response.set({
      "Cache-Control": "private, no-store",
      "Accept-Ranges": "bytes",
      "Content-Type": media.mimeType,
      "X-Content-Type-Options": "nosniff",
      "Content-Disposition": `${download === "1" ? "attachment" : "inline"}; filename="runway-media"; filename*=UTF-8''${encodeURIComponent(media.originalName)}`,
    });
    const range = normalizedRange(rawRange, media.sizeBytes);
    if (range === null) {
      response
        .status(416)
        .set("Content-Range", `bytes */${media.sizeBytes}`)
        .end();
      return;
    }
    const object = await this.storage.get(media.objectKey, range);
    if (!object.Body) {
      response.status(404).end();
      return;
    }
    response.status(range ? 206 : 200);
    if (object.ContentRange) response.set("Content-Range", object.ContentRange);
    response.set(
      "Content-Length",
      String(object.ContentLength ?? media.sizeBytes),
    );
    await pipeline(object.Body as Readable, response);
  }
}
