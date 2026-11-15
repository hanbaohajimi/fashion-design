import { readFile } from "node:fs/promises";
import sharp from "../../apps/worker/node_modules/sharp";
import type { Page } from "@playwright/test";

let photograph: Promise<Buffer> | undefined;
/** Real repository photograph, resized only for deterministic UI validation. */
export async function useCanvasPhotograph(page: Page) {
  photograph ??= readFile("apps/web/public/prototype-assets/impeccable/coat-original.png").then((bytes) => sharp(bytes).resize(600, 800, { fit: "contain", background: "#fff" }).png().toBuffer());
  const bytes = await photograph;
  await page.route("**/visual-garment.svg", (route) => route.fulfill({ contentType: "image/png", body: bytes }));
}
