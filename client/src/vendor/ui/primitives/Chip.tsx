import React from "react";
import { Icon, type IconName } from "../icons";

export function Chip({
  children,
  active,
  onClick,
  icon,
  count,
  color,
  disabled,
}: {
  children?: React.ReactNode;
  /** Toggle state. Leave undefined for a plain (non-toggle) chip — only a chip
   *  that declares `active` gets `aria-pressed`. */
  active?: boolean;
  onClick?: () => void;
  icon?: IconName;
  count?: number;
  color?: string;
  disabled?: boolean;
}) {
  const I = icon ? Icon[icon] : null;
  const [h, setH] = React.useState(false);
  const hover = h && !disabled;
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={active == null ? undefined : !!active}
      onMouseEnter={() => setH(true)}
      onMouseLeave={() => setH(false)}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 8,
        padding: "5px 12px",
        borderRadius: 6,
        fontSize: 13,
        fontWeight: 500,
        transition: "all .12s",
        border: "1px solid " + (active ? "var(--accent)" : "var(--border)"),
        background: active ? "var(--accent-bg)" : hover ? "var(--bg-hover)" : "transparent",
        color: active
          ? "var(--accent-text)"
          : hover
            ? "var(--text-primary)"
            : "var(--text-secondary)",
        opacity: disabled ? 0.45 : 1,
        cursor: disabled ? "default" : "pointer",
      }}
    >
      {I && <I size={13} style={color ? { color } : undefined} />}
      {children}
      {count != null && (
        <span className="tnum" style={{ opacity: 0.7, fontSize: 12 }}>
          {count}
        </span>
      )}
    </button>
  );
}
