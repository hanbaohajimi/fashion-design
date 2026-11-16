import translations from "@tldraw/assets/translations/zh-cn.json";
const missingTranslations = {
  "action.copy-hovered-styles": "复制悬停样式",
  "action.frame-selection": "为所选内容添加画板框",
  "page-menu.max-pages-reached": "已达到页面数量上限",
  "page-menu.resize": "调整页面菜单大小",
} as const;

export function GET(): Response {
  return Response.json(
    { ...translations, ...missingTranslations },
    {
      headers: {
        "Cache-Control": "public, max-age=3600, stale-while-revalidate=86400",
      },
    },
  );
}
