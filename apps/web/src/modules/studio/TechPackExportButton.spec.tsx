// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createExportSchema } from "../../../../api/src/modules/exports/exports.schemas";
import { TechPackExportButton } from "./TechPackExportButton";
const json = (body: unknown) =>
  new Response(JSON.stringify(body), { status: 200 });
beforeEach(() => vi.stubGlobal("fetch", vi.fn()));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
it("restores a completed export rather than creating another job", async () => {
  const fetcher = vi
    .mocked(fetch)
    .mockResolvedValueOnce(
      json({ items: [{ id: "export-old", status: "succeeded" }] }),
    )
    .mockResolvedValueOnce(
      json({
        id: "export-old",
        status: "succeeded",
        downloadUrl: "/private/pack.pdf",
      }),
    );
  render(<TechPackExportButton projectId="project-1" revisionId="r1" />);
  expect(
    (
      await screen.findByRole("link", { name: "下载已生成的技术包 PDF" })
    ).getAttribute("href"),
  ).toBe("/private/pack.pdf");
  expect(fetcher).toHaveBeenCalledTimes(2);
  expect(
    fetcher.mock.calls.every(([, options]) => options?.method !== "POST"),
  ).toBe(true);
});
it("reuses an idempotency key after the create response is lost", async () => {
  const fetcher = vi
    .mocked(fetch)
    .mockResolvedValueOnce(json({ items: [] }))
    .mockRejectedValueOnce(new Error("响应丢失"))
    .mockResolvedValueOnce(json({ id: "export-new", status: "queued" }));
  render(<TechPackExportButton projectId="project-1" revisionId="r1" />);
  await waitFor(() =>
    expect(
      (
        screen.getByRole("button", {
          name: "导出此修订 PDF",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(false),
  );
  fireEvent.click(screen.getByRole("button", { name: "导出此修订 PDF" }));
  await screen.findByText("响应丢失");
  fireEvent.click(screen.getByRole("button", { name: "重试导出" }));
  await screen.findByText(/导出排队中/);
  const posts = fetcher.mock.calls.filter(
    ([, options]) => options?.method === "POST",
  );
  expect(posts).toHaveLength(2);
  expect(new Headers(posts[0]?.[1]?.headers).get("Idempotency-Key")).toBe(
    new Headers(posts[1]?.[1]?.headers).get("Idempotency-Key"),
  );
  expect(JSON.parse(String(posts[1]?.[1]?.body))).toMatchObject({
    sourceType: "tech_pack",
    studioRevisionId: "r1",
    format: "pdf",
  });
});
it("ignores a late export response after switching revisions", async () => {
  let resolveOld: ((value: Response) => void) | undefined;
  vi.mocked(fetch).mockImplementation(async (input) => {
    const url = String(input);
    if (url.includes("sourceId=r1"))
      return new Promise<Response>((resolve) => {
        resolveOld = resolve;
      });
    if (url.includes("sourceId=r2"))
      return json({ items: [{ id: "export-r2", status: "succeeded" }] });
    return json({
      id: "export-r2",
      status: "succeeded",
      downloadUrl: "/private/r2.pdf",
    });
  });
  const view = render(
    <TechPackExportButton projectId="project-1" revisionId="r1" />,
  );
  view.rerender(<TechPackExportButton projectId="project-1" revisionId="r2" />);
  await screen.findByRole("link", { name: "下载已生成的技术包 PDF" });
  await act(async () =>
    resolveOld?.(json({ items: [{ id: "export-r1", status: "succeeded" }] })),
  );
  expect(
    screen
      .getByRole("link", { name: "下载已生成的技术包 PDF" })
      .getAttribute("href"),
  ).toBe("/private/r2.pdf");
});

it("creates a presentation PDF with the server export contract", async () => {
  const fetcher = vi
    .mocked(fetch)
    .mockResolvedValueOnce(json({ items: [] }))
    .mockResolvedValueOnce(json({ id: "presentation-pdf", status: "queued" }));
  render(
    <TechPackExportButton
      projectId="project-1"
      revisionId="presentation-r2"
      sourceType="presentation_set"
    />,
  );
  await waitFor(() =>
    expect(
      (
        screen.getByRole("button", {
          name: "导出此修订 PDF",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(false),
  );
  fireEvent.click(screen.getByRole("button", { name: "导出此修订 PDF" }));
  await screen.findByText(/导出排队中/);
  const post = fetcher.mock.calls.find(
    ([, options]) => options?.method === "POST",
  );
  const parsed = createExportSchema.parse(JSON.parse(String(post?.[1]?.body)));
  expect(parsed).toEqual({
    sourceType: "presentation_set",
    studioRevisionId: "presentation-r2",
    format: "pdf",
    quality: "standard",
  });
  expect(String(fetcher.mock.calls[0]?.[0])).toContain(
    "sourceType=presentation_set",
  );
});
