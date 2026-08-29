import React from "react";

export interface LogoProps {
  variante?: "lockup" | "simbolo";
  className?: string;
}

// Cores vêm por \`style\` e não por atributo de apresentação: var() em
// atributo de apresentação de SVG tem suporte inconsistente entre
// navegadores, enquanto em \`style\` é CSS comum e sempre funciona.
function Simbolo() {
  return (
    <g transform="translate(0,2)">
      <path d="M17 1V13" style={{ stroke: "var(--pr-text-tertiary)" }} strokeWidth="2" />
      <path d="M17 13L29 22H5L17 13Z" style={{ fill: "var(--pr-violet-600)" }} />
      <path d="M5 22H29L17 39L5 22Z" style={{ fill: "var(--pr-violet-500)" }} />
    </g>
  );
}

export function Logo({ variante = "lockup", className }: LogoProps) {
  if (variante === "simbolo") {
    return (
      <svg viewBox="0 0 34 44" role="img" aria-label="Tinocerto" className={className}>
        <title>Tinocerto</title>
        <Simbolo />
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 236 44" role="img" aria-label="Tinocerto" className={className}>
      <title>Tinocerto</title>
      <Simbolo />
      <text
        x="46"
        y="34"
        fontWeight="800"
        fontSize="34"
        letterSpacing="-1.1"
        fill="currentColor"
        style={{ fontFamily: "var(--pr-font-display)" }}
      >
        Tinocerto
      </text>
    </svg>
  );
}
