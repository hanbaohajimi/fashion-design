"use client";

import { useEffect, useRef, useState } from "react";

export const PROJECT_NAME_HINT = "名称长度为 3–80 个字符，部分特殊符号占 2 个字符。";
export function validateProjectName(value: string) {
  // 与现有 Zod string.min/max 和原生 maxlength 的 UTF-16 边界一致。
  const length = value.trim().length;
  return length < 3 || length > 80 ? "项目名称需为 3–80 个字符，部分特殊符号占 2 个字符。" : null;
}
export function useProjectNameValidation(value: string, active: boolean) {
  const [error, setError] = useState<string | null>(null);
  const [touched, setTouched] = useState(false);
  const [composing, setComposing] = useState(false);
  const animation = useRef<Animation | null>(null);
  useEffect(() => {
    if (!active || composing) return;
    const problem = validateProjectName(value);
    if (!problem) return;
    if (!value && !touched) return;
    const timer = setTimeout(() => setError(problem), 400);
    return () => clearTimeout(timer);
  }, [value, active, composing, touched]);
  useEffect(() => () => animation.current?.cancel(), []);
  const validate = (input?: HTMLInputElement | null) => {
    if (composing) return false;
    const problem = validateProjectName(value);
    setTouched(true);
    setError(problem);
    if (problem && input) {
      input.focus();
      animation.current?.cancel();
      if (!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
        animation.current = input.animate?.([
          { transform: "translateX(0)" }, { transform: "translateX(-4px)" },
          { transform: "translateX(4px)" }, { transform: "translateX(-2px)" },
          { transform: "translateX(2px)" }, { transform: "translateX(0)" },
        ], { duration: 400, easing: "cubic-bezier(.36,.07,.19,.97)" }) ?? null;
      }
    }
    return !problem;
  };
  return { error: validateProjectName(value) ? error : null, valid: Boolean(value.trim()) && !validateProjectName(value), validate,
    reset: () => { setError(null); setTouched(false); },
    onBlur: () => { if (!composing) { setTouched(true); setError(validateProjectName(value)); } },
    onCompositionStart: () => setComposing(true), onCompositionEnd: () => setComposing(false) };
}
