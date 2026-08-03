import React from "react";
import { Icon } from "../icons";

/** REAL controlled checkbox (styled). */
export function Checkbox({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean;
  onChange?: (v: boolean) => void;
  label?: React.ReactNode;
  /** Renders inert and stops firing `onChange`. The caller owns the "why". */
  disabled?: boolean;
}) {
  return (
    <label
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        fontSize: 14,
        color: disabled ? "var(--text-muted)" : "var(--text-secondary)",
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.6 : 1,
      }}
    >
      <button
        type="button"
        role="checkbox"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange?.(!checked)}
        style={{
          width: 16,
          height: 16,
          borderRadius: 4,
          border: "1.5px solid " + (checked ? "var(--accent)" : "var(--border-strong)"),
          background: checked ? "var(--accent)" : "transparent",
          display: "grid",
          placeItems: "center",
          padding: 0,
          cursor: disabled ? "not-allowed" : "pointer",
        }}
      >
        {checked && <Icon.Check size={11} style={{ color: "#fff" }} />}
      </button>
      {label}
    </label>
  );
}
