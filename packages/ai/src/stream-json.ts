/** Root strings only: nested tool arguments and reasoning never become display text. */
export function rootStringFields(source: string): Record<string, string> {
  const result: Record<string, string> = {};
  let depth = 0;
  let key: string | null = null;
  let expectingKey = false;
  for (let i = 0; i < source.length; i++) {
    const c = source[i];
    if (c === '"') {
      let value = ""; let closed = false;
      for (i++; i < source.length; i++) {
        const ch = source[i];
        if (ch === '"') { closed = true; break; }
        if (ch !== "\\") { value += ch; continue; }
        const escape = source[++i];
        if (escape === undefined) break;
        if (escape === "u") {
          const hex = source.slice(i + 1, i + 5);
          if (!/^[\da-f]{4}$/iu.test(hex)) break;
          value += String.fromCharCode(Number.parseInt(hex, 16)); i += 4;
        } else {
          const decoded: Record<string, string> = { '"': '"', "\\": "\\", "/": "/", b: "\b", f: "\f", n: "\n", r: "\r", t: "\t" };
          if (!(escape in decoded)) break;
          value += decoded[escape];
        }
      }
      // Do not emit a dangling high surrogate between network chunks.
      if (/[\uD800-\uDBFF]$/u.test(value)) value = value.slice(0, -1);
      if (depth === 1) {
        if (expectingKey && closed) { key = value; expectingKey = false; }
        else if (key) { if (closed || key === "message") result[key] = value; key = null; }
      }
    } else if (c === "{" || c === "[") { depth++; if (depth === 1) expectingKey = true; else if (depth === 2) key = null; }
    else if (c === "}" || c === "]") depth--;
    else if (c === "," && depth === 1) { expectingKey = true; key = null; }
  }
  return result;
}
