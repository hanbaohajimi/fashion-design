import { describe, expect, it } from "vitest";

import { nextOccurrence, scheduleAnchorFor } from "./schedule";

describe("assistant delegation schedule", () => {
  it("keeps the selected month day through short months", () => {
    const january = new Date("2026-01-31T09:15:00.000Z");
    const anchor = scheduleAnchorFor(january, "UTC");
    const february = nextOccurrence(
      january,
      "MONTHLY",
      "UTC",
      anchor,
      january,
    );
    const march = nextOccurrence(
      february,
      "MONTHLY",
      "UTC",
      anchor,
      february,
    );

    expect(february.toISOString()).toBe("2026-02-28T09:15:00.000Z");
    expect(march.toISOString()).toBe("2026-03-31T09:15:00.000Z");
  });

  it("keeps local wall time across daylight-saving transitions", () => {
    const beforeSpringForward = new Date("2026-03-07T07:30:00.000Z");
    const timeZone = "America/New_York";
    const anchor = scheduleAnchorFor(beforeSpringForward, timeZone);
    const missingLocalTime = nextOccurrence(
      beforeSpringForward,
      "DAILY",
      timeZone,
      anchor,
      beforeSpringForward,
    );
    const nextDay = nextOccurrence(
      missingLocalTime,
      "DAILY",
      timeZone,
      anchor,
      missingLocalTime,
    );
    const format = new Intl.DateTimeFormat("en-US", {
      day: "2-digit",
      hour: "2-digit",
      hourCycle: "h23",
      minute: "2-digit",
      month: "2-digit",
      timeZone,
      year: "numeric",
    });

    expect(format.format(missingLocalTime)).toContain("03:30");
    expect(format.format(nextDay)).toContain("02:30");
  });

  it("does not move a future schedule when a user runs it early", () => {
    const from = new Date("2026-08-10T09:00:00.000Z");
    const anchor = scheduleAnchorFor(from, "UTC");

    expect(
      nextOccurrence(
        from,
        "DAILY",
        "UTC",
        anchor,
        new Date("2026-08-09T09:00:00.000Z"),
      ),
    ).toEqual(from);
  });
});
