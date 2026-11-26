import type { ComponentProps } from "react";
import type { ClerkProvider } from "@clerk/nextjs";

type Appearance = NonNullable<ComponentProps<typeof ClerkProvider>["appearance"]>;

/**
 * Clerk components read the shadcn tokens in src/app/globals.css as CSS custom
 * properties, so they follow the light/dark toggle (.dark on <html>) with no extra work.
 */
export const clerkAppearance: Appearance = {
  variables: {
    colorPrimary: "var(--primary)",
    colorPrimaryForeground: "var(--primary-foreground)",
    colorBackground: "var(--card)",
    colorForeground: "var(--card-foreground)",
    colorMuted: "var(--muted)",
    colorMutedForeground: "var(--muted-foreground)",
    colorInput: "var(--background)",
    colorInputForeground: "var(--foreground)",
    colorBorder: "var(--border)",
    colorRing: "var(--ring)",
    colorNeutral: "var(--foreground)",
    colorModalBackdrop: "rgb(0 0 0 / 0.5)",
    fontFamily: "var(--font-geist-sans), system-ui, sans-serif",
    fontFamilyButtons: "var(--font-geist-sans), system-ui, sans-serif",
    borderRadius: "0.625rem",
  },
  elements: {
    card: "border border-border shadow-sm",
    headerTitle: "tracking-tight",
    formButtonPrimary: "font-medium shadow-xs",
  },
};
