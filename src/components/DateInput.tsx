import { useLayoutEffect, useRef, useState, type CSSProperties, type InputHTMLAttributes } from "react";
import { formatDate } from "../lib/formatDate";

// 2026-10-14 (Sandra): a native <input type="date"> shows the computer's
// regional format (dd/mm/yyyy on PH laptops). DateInput keeps the native
// input and its calendar picker, hides the input's own text, and draws the
// date on top as mm/dd/yyyy so every date box in Tempo reads the same way.
// Drop-in replacement for <input type="date" ... />.
type Props = Omit<InputHTMLAttributes<HTMLInputElement>, "type">;

export default function DateInput({ style, className, value, defaultValue, onChange, onClick, ...rest }: Props) {
  const ref = useRef<HTMLInputElement>(null);
  const [uncontrolled, setUncontrolled] = useState<string>(defaultValue != null ? String(defaultValue) : "");
  const shown = value !== undefined ? String(value ?? "") : uncontrolled;
  const [pad, setPad] = useState<CSSProperties>({});
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const cs = getComputedStyle(el);
    setPad({
      paddingLeft: `calc(${cs.paddingLeft} + ${cs.borderLeftWidth})`,
      fontSize: cs.fontSize,
      fontFamily: cs.fontFamily,
      fontWeight: cs.fontWeight as CSSProperties["fontWeight"],
      color: cs.color === "rgba(0, 0, 0, 0)" ? undefined : cs.color,
    });
  }, [className, style]);
  const fill = style?.width === "100%" || !!style?.flex;
  return (
    <span
      className="date-input-wrap"
      style={{
        position: "relative",
        display: fill ? "block" : "inline-block",
        verticalAlign: "middle",
        width: style?.width,
        flex: style?.flex,
        minWidth: style?.minWidth,
        maxWidth: style?.maxWidth,
        marginBottom: style?.marginBottom,
      }}
    >
      <input
        {...rest}
        ref={ref}
        type="date"
        value={value}
        defaultValue={value === undefined ? defaultValue : undefined}
        className={`${className ?? ""} date-input-native`.trim()}
        style={{ ...style, width: style?.width ? "100%" : undefined, flex: undefined, marginBottom: style?.marginBottom !== undefined ? 0 : undefined }}
        onChange={(e) => {
          if (value === undefined) setUncontrolled(e.target.value);
          onChange?.(e);
        }}
        onClick={(e) => {
          onClick?.(e);
          const el = e.currentTarget as HTMLInputElement & { showPicker?: () => void };
          try {
            el.showPicker?.();
          } catch {
            // ignore
          }
        }}
      />
      <span className="date-input-text" aria-hidden="true" style={{ ...pad, opacity: shown ? 1 : 0.55 }}>
        {shown ? formatDate(shown) : "mm/dd/yyyy"}
      </span>
    </span>
  );
}
