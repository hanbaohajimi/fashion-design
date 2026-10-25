"use client";
import { useEffect, useLayoutEffect, useRef } from "react";
import "./picker.css";
const names = ["矩阵", "比较", "队列"];
export function VariantPicker({
  value,
  onChange,
  onReplay,
}: {
  readonly value: number;
  readonly onChange: (value: number) => void;
  readonly onReplay: () => void;
}) {
  const root = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    const measure = () => {
      const item = root.current?.querySelector<HTMLElement>("[data-active]");
      const highlight = root.current?.querySelector<HTMLElement>(
        ".proto-picker-highlight",
      );
      if (item && highlight) {
        highlight.style.width = `${item.offsetWidth}px`;
        highlight.style.transform = `translateX(${item.offsetLeft}px)`;
      }
    };
    measure();
    window.addEventListener("resize", measure);
    let second = 0;
    const first = requestAnimationFrame(() => {
      second = requestAnimationFrame(() =>
        root.current?.setAttribute("data-ready", ""),
      );
    });
    return () => {
      cancelAnimationFrame(first);
      cancelAnimationFrame(second);
      window.removeEventListener("resize", measure);
    };
  }, [value]);
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      const target = event.target;
      if (
        event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        event.shiftKey ||
        (target instanceof HTMLElement &&
          (target.closest("input,textarea,select,dialog") ||
            target.isContentEditable))
      )
        return;
      const number = Number(event.key);
      if (number >= 1 && number <= 3) {
        event.preventDefault();
        onChange(number - 1);
      } else if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
        event.preventDefault();
        onChange((value + (event.key === "ArrowRight" ? 1 : 2)) % 3);
      } else if (event.key.toLowerCase() === "r") onReplay();
    };
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  }, [value, onChange, onReplay]);
  return (
    <nav ref={root} className="proto-picker" aria-label="Prototype variants">
      <span className="proto-picker-highlight" aria-hidden="true" />
      {names.map((name, index) => (
        <button
          type="button"
          key={name}
          className="proto-picker-item"
          data-active={value === index ? "" : undefined}
          aria-current={value === index ? "true" : undefined}
          onClick={() => onChange(index)}
        >
          {name}
        </button>
      ))}
    </nav>
  );
}
