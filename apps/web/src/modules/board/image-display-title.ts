/** Translate automatic legacy image labels without changing stored names or user prose. */
export function imageDisplayTitle(title: string) {
  return title.replace(/^候选(?:图|图片|方案)?(?=\s+[A-Z0-9]+$)/u, "生成图");
}
