import { FileStatus, type PrismaClient } from "@fashion/db";
import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from "@nestjs/common";
import { FILES_DB, THUMBNAIL_JOBS } from "./files.service";
import type { ThumbnailJobs } from "./thumbnail-queue.service";

const BATCH_SIZE = 100;
const INTERVAL_MS = 15_000;
const DISPATCH_GRACE_MS = 30_000;

@Injectable()
export class ThumbnailRecoveryService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ThumbnailRecoveryService.name);
  private timer: ReturnType<typeof setInterval> | undefined;
  private flight: Promise<void> | undefined;
  private cursor: string | undefined;
  private stopping = false;

  constructor(
    @Inject(FILES_DB)
    private readonly database: Pick<PrismaClient, "fileAsset">,
    @Inject(THUMBNAIL_JOBS) private readonly jobs: ThumbnailJobs,
  ) {}

  onModuleInit(): void {
    const tick = () => {
      void this.run().catch(() =>
        this.logger.warn("缩略图恢复暂不可用，稍后自动重试"),
      );
    };
    this.timer = setInterval(tick, INTERVAL_MS);
    this.timer.unref();
    tick();
  }

  run(): Promise<void> {
    if (this.stopping) return Promise.resolve();
    this.flight ??= this.reconcile().finally(() => {
      this.flight = undefined;
    });
    return this.flight;
  }

  private async reconcile(): Promise<void> {
    // PROCESSING is persisted only after the upload has been inspected. Never
    // enqueue unconfirmed uploads or silently restart a terminal FAILED file.
    const files = await this.database.fileAsset.findMany({
      where: {
        status: FileStatus.PROCESSING,
        completedAt: { lte: new Date(Date.now() - DISPATCH_GRACE_MS) },
        ...(this.cursor ? { id: { gt: this.cursor } } : {}),
      },
      select: { id: true },
      orderBy: { id: "asc" },
      take: BATCH_SIZE,
    });
    this.cursor = files.length === BATCH_SIZE ? files.at(-1)?.id : undefined;
    for (const file of files) {
      if (this.stopping) break;
      try {
        // The queue uses the file ID and preserves waiting/active jobs; the
        // processor checks the current upload generation before committing.
        await this.jobs.enqueue(file.id);
      } catch {
        this.logger.warn(`缩略图任务 ${file.id} 恢复等待重试`);
      }
    }
  }

  async onModuleDestroy(): Promise<void> {
    this.stopping = true;
    if (this.timer) clearInterval(this.timer);
    await this.flight;
  }
}
