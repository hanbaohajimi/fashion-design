import { getAssetUrlsByMetaUrl } from "@tldraw/assets/urls";

// Ship the pinned SDK's fonts, icons, and translations with the application.
const bundled = getAssetUrlsByMetaUrl();
export const tldrawAssetUrls = {
  ...bundled,
  translations: { ...bundled.translations, "zh-cn": "/tldraw-translations/zh-cn" },
};
