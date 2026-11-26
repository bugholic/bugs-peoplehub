import type { ReactNode } from "react";
import { Avatar } from "@/components/ui";
import { Logo } from "@/components/nav-sidebar";
import { ThemeToggle } from "@/components/theme-toggle";

/** Brand panel + centred Clerk form, shared by the sign-in and sign-up pages. */
export function AuthShell({ children }: { children: ReactNode }) {
  return (
    <div className="grid min-h-screen lg:grid-cols-[1.05fr_1fr]">
      <section className="relative hidden overflow-hidden bg-night p-12 text-white lg:flex lg:flex-col">
        <Logo />
        <div aria-hidden className="pointer-events-none absolute -right-24 top-1/4 size-[420px] rounded-full bg-primary/40 blur-3xl" />
        <div aria-hidden className="pointer-events-none absolute -bottom-20 left-10 size-64 rounded-full bg-marigold/25 blur-3xl" />

        <div className="relative mt-auto max-w-md">
          <h1 className="text-5xl font-semibold leading-[1.05] tracking-tight">Your whole team, in one calm place.</h1>
          <p className="mt-5 text-lg leading-relaxed text-white/60">
            Check in, request time off, and find anyone in the company without chasing a spreadsheet.
          </p>
          <div className="mt-10 flex items-center gap-3">
            <div className="flex -space-x-2">
              {["Asha Rao", "Vikram Shah", "Neha Iyer", "Rohan Das"].map((n) => (
                <Avatar key={n} name={n} size="md" className="ring-2 ring-night" />
              ))}
            </div>
            <p className="text-sm text-white/50">Directory, leave and attendance together</p>
          </div>
        </div>
      </section>

      <section className="relative flex flex-col items-center justify-center gap-8 px-5 py-12">
        <div className="absolute right-4 top-4">
          <ThemeToggle />
        </div>
        <Logo className="lg:hidden" />
        {children}
      </section>
    </div>
  );
}
