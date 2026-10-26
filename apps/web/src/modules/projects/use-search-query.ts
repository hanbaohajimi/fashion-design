"use client";

import { useEffect, useState } from "react";

/** 等输入法提交后再搜索，避免把拼音中的每一次变化当作查询。 */
export function useSearchQuery(value: string) {
  const [query, setQuery] = useState(value.trim());
  const [composing, setComposing] = useState(false);
  useEffect(() => {
    if (composing) return;
    const timer = setTimeout(() => setQuery(value.trim()), 300);
    return () => clearTimeout(timer);
  }, [value, composing]);
  return { query, pending: composing || query !== value.trim(),
    onCompositionStart: () => setComposing(true), onCompositionEnd: () => setComposing(false) };
}
