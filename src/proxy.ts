import { clerkMiddleware } from "@clerk/nextjs/server";

/**
 * Makes Clerk's auth() available to pages and route handlers. Authorization is NOT decided
 * here by URL pattern; each resource checks for itself (resource-based auth):
 *   - pages: requirePageSession() in (app)/layout.tsx and the admin pages
 *   - API routes: requireSession() (JSON 401/403)
 *   - data: the tenant-scoped db client (src/lib/db.ts) refuses to run without an active org
 */
export default clerkMiddleware();

export const config = {
  matcher: [
    // Skip Next internals and static files, always run for API routes.
    "/((?!_next|[^?]*\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
    // Clerk Frontend API auto-proxy on production *.vercel.app hosts (pk_live_ keys only).
    // Needed explicitly: the first pattern skips .js files, and clerk-js loads through /__clerk/npm/...js.
    "/__clerk/:path*",
  ],
};
