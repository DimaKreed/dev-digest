/* CodeBlock — a monospaced block for a fact the tour states verbatim.
   Renders its content as TEXT, never as markup: the value comes from the
   repository or from the model, so it is displayed and never interpreted. */
"use client";

import React from "react";
import { s } from "./styles";

export function CodeBlock({ children }: { children: string }) {
  return (
    <pre className="mono" style={s.block}>
      {children}
    </pre>
  );
}
