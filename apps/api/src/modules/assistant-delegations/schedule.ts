export type DelegationCadence = "ONCE" | "DAILY" | "WEEKLY" | "MONTHLY";

export interface ScheduleAnchor {
  readonly dayOfMonth: number;
  readonly hour: number;
  readonly minute: number;
  readonly second: number;
}

interface LocalDateTime extends ScheduleAnchor {
  readonly year: number;
  readonly month: number;
  readonly day: number;
}

const formatterCache = new Map<string, Intl.DateTimeFormat>();
const SIX_HOURS_MS = 6 * 60 * 60 * 1_000;
const SEARCH_RADIUS_MS = 36 * 60 * 60 * 1_000;

export function scheduleAnchorFor(
  value: Date,
  timeZone: string,
): ScheduleAnchor {
  const local = localParts(value, timeZone);
  return {
    dayOfMonth: local.day,
    hour: local.hour,
    minute: local.minute,
    second: local.second,
  };
}

export function nextOccurrence(
  from: Date,
  cadence: DelegationCadence,
  timeZone: string,
  anchor: ScheduleAnchor,
  now = new Date(),
): Date {
  if (cadence === "ONCE" || from > now) return new Date(from);

  let cursor = localParts(from, timeZone);
  while (true) {
    cursor = nextLocalDate(cursor, cadence, anchor);
    const candidate = toInstant(cursor, timeZone);
    if (candidate > now) return candidate;
  }
}

function nextLocalDate(
  current: LocalDateTime,
  cadence: Exclude<DelegationCadence, "ONCE">,
  anchor: ScheduleAnchor,
): LocalDateTime {
  if (cadence === "MONTHLY") {
    const monthStart = new Date(
      Date.UTC(current.year, current.month, 1),
    );
    const year = monthStart.getUTCFullYear();
    const month = monthStart.getUTCMonth() + 1;
    const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
    return {
      day: Math.min(anchor.dayOfMonth, lastDay),
      dayOfMonth: anchor.dayOfMonth,
      hour: anchor.hour,
      minute: anchor.minute,
      month,
      second: anchor.second,
      year,
    };
  }

  const days = cadence === "DAILY" ? 1 : 7;
  const next = new Date(
    Date.UTC(current.year, current.month - 1, current.day + days),
  );
  return {
    day: next.getUTCDate(),
    dayOfMonth: anchor.dayOfMonth,
    hour: anchor.hour,
    minute: anchor.minute,
    month: next.getUTCMonth() + 1,
    second: anchor.second,
    year: next.getUTCFullYear(),
  };
}

function toInstant(target: LocalDateTime, timeZone: string): Date {
  const targetTimestamp = timestamp(target);
  const offsets = new Set<number>();
  for (
    let delta = -SEARCH_RADIUS_MS;
    delta <= SEARCH_RADIUS_MS;
    delta += SIX_HOURS_MS
  ) {
    const sampleTimestamp = targetTimestamp + delta;
    offsets.add(
      timestamp(localParts(new Date(sampleTimestamp), timeZone)) -
        sampleTimestamp,
    );
  }

  const candidates = [...offsets].map((offset) => targetTimestamp - offset);
  const exactMatches = candidates.filter((candidate) =>
    sameLocalParts(localParts(new Date(candidate), timeZone), target),
  );
  if (exactMatches.length) {
    return new Date(Math.min(...exactMatches));
  }

  const shiftedMatches = candidates
    .map((candidate) => ({
      candidate,
      localTimestamp: timestamp(localParts(new Date(candidate), timeZone)),
    }))
    .filter(({ localTimestamp }) => localTimestamp > targetTimestamp)
    .sort(
      (left, right) =>
        left.localTimestamp - right.localTimestamp ||
        left.candidate - right.candidate,
    );
  if (!shiftedMatches.length) {
    throw new RangeError("无法将本地执行时间转换为有效时刻");
  }
  const shifted = shiftedMatches[0];
  if (!shifted) {
    throw new RangeError("无法将本地执行时间转换为有效时刻");
  }
  return new Date(shifted.candidate);
}

function localParts(value: Date, timeZone: string): LocalDateTime {
  let formatter = formatterCache.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-GB", {
      day: "2-digit",
      hour: "2-digit",
      hourCycle: "h23",
      minute: "2-digit",
      month: "2-digit",
      second: "2-digit",
      timeZone,
      year: "numeric",
    });
    formatterCache.set(timeZone, formatter);
  }
  const values = new Map(
    formatter
      .formatToParts(value)
      .map((part) => [part.type, Number(part.value)]),
  );
  const year = values.get("year");
  const month = values.get("month");
  const day = values.get("day");
  const hour = values.get("hour");
  const minute = values.get("minute");
  const second = values.get("second");
  if (
    year === undefined ||
    month === undefined ||
    day === undefined ||
    hour === undefined ||
    minute === undefined ||
    second === undefined
  ) {
    throw new RangeError("无法读取本地执行时间");
  }
  return {
    day,
    dayOfMonth: day,
    hour,
    minute,
    month,
    second,
    year,
  };
}

function timestamp(value: Pick<LocalDateTime, "year" | "month" | "day" | "hour" | "minute" | "second">): number {
  return Date.UTC(
    value.year,
    value.month - 1,
    value.day,
    value.hour,
    value.minute,
    value.second,
  );
}

function sameLocalParts(left: LocalDateTime, right: LocalDateTime): boolean {
  return (
    left.year === right.year &&
    left.month === right.month &&
    left.day === right.day &&
    left.hour === right.hour &&
    left.minute === right.minute &&
    left.second === right.second
  );
}
