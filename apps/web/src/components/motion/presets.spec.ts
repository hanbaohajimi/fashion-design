/** @vitest-environment jsdom */
import mojs from "@mojs/core";
import { describe, expect, it } from "vitest";
import { composeEffect, type CoutureEffect } from "./presets";

describe("real Mo.js preset compatibility", () => {
  it.each<CoutureEffect>([
    "archive",
    "signature",
    "stitch",
    "material",
    "needle",
    "thread",
    "reveal",
    "seal",
  ])("constructs, plays and stops %s", (effect) => {
    const host = document.createElement("div");
    document.body.append(host);
    Object.defineProperties(host, {
      clientWidth: { value: 240 },
      clientHeight: { value: 160 },
    });
    document.documentElement.style.setProperty(
      "--ease-enter",
      "cubic-bezier(0.23, 1, 0.32, 1)",
    );
    const animation = composeEffect(
      mojs,
      effect,
      host,
      420,
      ["#263950", "#d8c9b8"],
      false,
    );
    try {
      animation.play();
      expect(host.querySelectorAll("svg").length).toBeGreaterThan(0);
    } finally {
      animation.stop();
      host.remove();
    }
  });
});
