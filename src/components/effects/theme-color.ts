"use client";

import { useEffect, useState } from "react";

/**
 * Canvas and WebGL effects need a plain hex color, but the theme defines colors in OKLCH
 * (a color space browsers understand in CSS, not in WebGL code). This paints the CSS variable onto
 * a 1×1 canvas and reads the pixel back.
 */
export function resolveThemeColor(variable: string, fallback = "#808080"): string {
  if (typeof window === "undefined") return fallback;
  const value = getComputedStyle(document.documentElement).getPropertyValue(variable).trim();
  const context = document.createElement("canvas").getContext("2d", { willReadFrequently: true });
  if (!value || !context) return fallback;
  context.fillStyle = value;
  context.fillRect(0, 0, 1, 1);
  const [r, g, b] = context.getImageData(0, 0, 1, 1).data;
  return `#${[r, g, b].map((channel) => (channel ?? 0).toString(16).padStart(2, "0")).join("")}`;
}

/** A theme color as hex (`#rrggbb`), updated when the page switches between light and dark mode. */
export function useThemeColor(variable: string, fallback?: string): string | null {
  const [color, setColor] = useState<string | null>(null);
  useEffect(() => {
    const update = () => setColor(resolveThemeColor(variable, fallback));
    update();
    const observer = new MutationObserver(update);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class", "style", "data-theme"] });
    return () => observer.disconnect();
  }, [variable, fallback]);
  return color;
}

/** True when the page is in dark mode (the `dark` class on the root element). */
export function useIsDark(): boolean {
  const [dark, setDark] = useState(false);
  useEffect(() => {
    const update = () => setDark(document.documentElement.classList.contains("dark"));
    update();
    const observer = new MutationObserver(update);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);
  return dark;
}
