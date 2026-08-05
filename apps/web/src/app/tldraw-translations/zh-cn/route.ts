const TLDRAW_ZH_CN_URL =
  "https://cdn.tldraw.com/5.2.5/translations/zh-cn.json";
const missingTranslations = {
  "action.copy-hovered-styles": "复制悬停样式",
  "action.frame-selection": "为所选内容添加画板框",
  "page-menu.max-pages-reached": "已达到页面数量上限",
  "page-menu.resize": "调整页面菜单大小",
} as const;

export async function GET(): Promise<Response> {
  let translations: Record<string, string> = {};

  try {
    const response = await fetch(TLDRAW_ZH_CN_URL, {
      next: { revalidate: 86_400 },
    });
    if (response.ok) {
      const payload = (await response.json()) as unknown;
      if (payload && typeof payload === "object" && !Array.isArray(payload)) {
        translations = Object.fromEntries(
          Object.entries(payload).filter(
            (entry): entry is [string, string] =>
              typeof entry[1] === "string",
          ),
        );
      }
    }
  } catch {
    // tldraw itself falls back to English when a locale asset is unavailable.
  }

  return Response.json(
    { ...translations, ...missingTranslations },
    {
      headers: {
        "Cache-Control": "public, max-age=3600, stale-while-revalidate=86400",
      },
    },
  );
}
