import {
  GENERATION_QUEUE_NAME,
  type GenerationTaskEvent,
  type GenerationTaskEventStatus,
} from "@fashion/shared";
import {
  Inject,
  Injectable,
  type MessageEvent,
  type OnModuleDestroy,
  Optional,
} from "@nestjs/common";
import { QueueEvents } from "bullmq";
import { Observable, type Subscriber } from "rxjs";

const EVENT_STATUSES = new Set<GenerationTaskEventStatus>([
  "queued",
  "running",
  "succeeded",
  "failed",
  "canceled",
]);
export const GENERATION_EVENTS_QUEUE_NAME = Symbol(
  "GENERATION_EVENTS_QUEUE_NAME",
);

function redisConnection() {
  const redisUrl = new URL(process.env.REDIS_URL ?? "redis://127.0.0.1:6379");
  return {
    host: redisUrl.hostname,
    password: redisUrl.password || undefined,
    port: Number(redisUrl.port || 6379),
    username: redisUrl.username || undefined,
  };
}

@Injectable()
export class GenerationEventsService implements OnModuleDestroy {
  private readonly subscribers = new Map<
    string,
    Set<Subscriber<MessageEvent>>
  >();
  private queueEvents: QueueEvents | undefined;

  constructor(
    @Optional()
    @Inject(GENERATION_EVENTS_QUEUE_NAME)
    private readonly queueName: string = GENERATION_QUEUE_NAME,
  ) {}

  async stream(
    initial: GenerationTaskEvent,
  ): Promise<Observable<MessageEvent>> {
    await this.ensureQueueEvents();
    return new Observable<MessageEvent>((subscriber) => {
      subscriber.next({ data: initial, type: "generation" });
      if (
        initial.status === "succeeded" ||
        initial.status === "failed" ||
        initial.status === "canceled"
      ) {
        subscriber.complete();
        return undefined;
      }

      const taskSubscribers =
        this.subscribers.get(initial.taskId) ??
        new Set<Subscriber<MessageEvent>>();
      taskSubscribers.add(subscriber);
      this.subscribers.set(initial.taskId, taskSubscribers);

      const heartbeat = setInterval(() => {
        subscriber.next({
          data: { timestamp: new Date().toISOString() },
          type: "heartbeat",
        });
      }, 15_000);

      return () => {
        clearInterval(heartbeat);
        taskSubscribers.delete(subscriber);
        if (taskSubscribers.size === 0) {
          this.subscribers.delete(initial.taskId);
        }
      };
    });
  }

  async onModuleDestroy(): Promise<void> {
    for (const taskSubscribers of this.subscribers.values()) {
      for (const subscriber of taskSubscribers) {
        subscriber.complete();
      }
    }
    this.subscribers.clear();
    await this.queueEvents?.close();
  }

  private async ensureQueueEvents(): Promise<void> {
    if (this.queueEvents) {
      return;
    }
    this.queueEvents = new QueueEvents(this.queueName, {
      connection: redisConnection(),
    });
    this.queueEvents.on("progress", ({ data, jobId }) => {
      const event = this.parseEvent(data, jobId);
      if (event) {
        this.publish(event);
      }
    });
    this.queueEvents.on("completed", ({ jobId, returnvalue }) => {
      this.publish(
        this.fallbackEvent(
          jobId,
          this.completedStatus(returnvalue),
        ),
      );
    });
    this.queueEvents.on("failed", ({ jobId }) => {
      this.publish(this.fallbackEvent(jobId, "failed"));
    });
    await this.queueEvents.waitUntilReady();
  }

  private publish(event: GenerationTaskEvent): void {
    const taskSubscribers = this.subscribers.get(event.taskId);
    if (!taskSubscribers) {
      return;
    }
    for (const subscriber of taskSubscribers) {
      subscriber.next({ data: event, type: "generation" });
      if (
        event.status === "succeeded" ||
        event.status === "failed" ||
        event.status === "canceled"
      ) {
        subscriber.complete();
      }
    }
    if (
      event.status === "succeeded" ||
      event.status === "failed" ||
      event.status === "canceled"
    ) {
      this.subscribers.delete(event.taskId);
    }
  }

  private parseEvent(
    data: unknown,
    jobId: string,
  ): GenerationTaskEvent | null {
    if (
      typeof data !== "object" ||
      data === null ||
      !("taskId" in data) ||
      !("status" in data) ||
      !("timestamp" in data)
    ) {
      return null;
    }
    const candidate = data as Record<string, unknown>;
    if (
      candidate.taskId !== jobId ||
      typeof candidate.status !== "string" ||
      !EVENT_STATUSES.has(candidate.status as GenerationTaskEventStatus) ||
      typeof candidate.timestamp !== "string"
    ) {
      return null;
    }
    return {
      taskId: jobId,
      status: candidate.status as GenerationTaskEventStatus,
      timestamp: candidate.timestamp,
    };
  }

  private fallbackEvent(
    taskId: string,
    status: GenerationTaskEventStatus,
  ): GenerationTaskEvent {
    return {
      taskId,
      status,
      timestamp: new Date().toISOString(),
    };
  }

  private completedStatus(value: unknown): GenerationTaskEventStatus {
    let parsed = value;
    if (typeof value === "string") {
      try {
        parsed = JSON.parse(value) as unknown;
      } catch {
        return "succeeded";
      }
    }
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      "status" in parsed &&
      (parsed.status === "succeeded" || parsed.status === "canceled")
    ) {
      return parsed.status;
    }
    return "succeeded";
  }
}
