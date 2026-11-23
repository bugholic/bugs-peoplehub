import type { ComponentProps } from "react";
import type { ClerkProvider } from "@clerk/nextjs";

type Appearance = NonNullable<ComponentProps<typeof ClerkProvider>["appearance"]>;

/**
 * Clerk components inherit the app's design tokens (src/app/globals.css), so they follow
 * the light/dark switch with no extra work: variables are CSS custom properties, not
 * fixed colours. Change the palette in globals.css and Clerk follows.
 */
export const clerkAppearance: Appearance = {
  variables: {
    colorPrimary: "var(--brand)",
    colorPrimaryForeground: "#ffffff",
    colorBackground: "var(--surface)",
    colorForeground: "var(--ink)",
    colorMuted: "var(--surface-2)",
    colorMutedForeground: "var(--ink-2)",
    colorInput: "var(--surface)",
    colorInputForeground: "var(--ink)",
    colorBorder: "var(--line)",
    colorRing: "var(--brand)",
    colorNeutral: "var(--ink)",
    colorModalBackdrop: "rgb(22 21 43 / 0.55)",
    fontFamily: "var(--font-body), system-ui, sans-serif",
    fontFamilyButtons: "var(--font-body), system-ui, sans-serif",
    borderRadius: "0.75rem",
  },
  elements: {
    card: "border border-line shadow-card",
    headerTitle: "font-display tracking-tight",
    formButtonPrimary: "font-semibold shadow-sm shadow-brand/30",
  },
};
