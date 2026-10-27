/** A candidate-confirmation key can arrive after compositionend on Windows. */
export function createImeGuard(now: () => number = () => performance.now()) {
  let composing = false;
  let endedAt = -Infinity;
  return {
    start() { composing = true; endedAt = -Infinity; },
    end() { composing = false; endedAt = now(); },
    blocks(event: { key: string; isComposing?: boolean; keyCode?: number }) {
      if (composing || event.isComposing || event.keyCode === 229) return true;
      if (event.key === "Enter" && now() - endedAt < 500) { endedAt = -Infinity; return true; }
      if (event.key !== "Enter") endedAt = -Infinity;
      return false;
    },
  };
}
