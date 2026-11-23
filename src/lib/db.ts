import { auth } from "@clerk/nextjs/server";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";
import { ApiError } from "./errors";

function createClient() {
  const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
  return new PrismaClient({ adapter });
}

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

/**
 * Raw client with NO tenant filtering. Only for code that legitimately spans
 * organizations (seed scripts, one-off maintenance). Request code uses `db`.
 */
export const dbUnscoped = globalForPrisma.prisma ?? createClient();
if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = dbUnscoped;

async function activeOrgId(): Promise<string> {
  const { orgId } = await auth();
  if (!orgId) throw new ApiError(403, "NO_ORGANIZATION", "Select an organization to continue");
  return orgId;
}

type Json = Record<string, unknown>;
const withOrg = (data: unknown, organizationId: string) =>
  Array.isArray(data) ? data.map((d) => ({ ...d, organizationId })) : { ...(data as Json), organizationId };

/**
 * Tenant-scoped client. Every model carries `organizationId`; this extension
 * reads the active Clerk org on each query, ANDs it into every read/update/delete
 * filter and stamps it on every create, so a missing `where` clause can't leak
 * another organization's rows and a missing active org fails closed.
 *
 * Caller-supplied foreign keys (e.g. a departmentId from a request body) are
 * NOT checked here; validate those with a scoped lookup before writing.
 */
export const db = dbUnscoped.$extends({
  name: "tenant-scope",
  query: {
    $allModels: {
      async $allOperations({ operation, args, query }) {
        const organizationId = await activeOrgId();
        const a = (args ?? {}) as Json;

        switch (operation) {
          case "create":
            a.data = withOrg(a.data, organizationId);
            break;
          case "createMany":
          case "createManyAndReturn":
            a.data = withOrg(a.data, organizationId);
            break;
          case "upsert":
            a.where = { ...(a.where as Json), organizationId };
            a.create = withOrg(a.create, organizationId);
            break;
          case "findUnique":
          case "findUniqueOrThrow":
          case "findFirst":
          case "findFirstOrThrow":
          case "findMany":
          case "count":
          case "aggregate":
          case "groupBy":
          case "update":
          case "updateMany":
          case "updateManyAndReturn":
          case "delete":
          case "deleteMany":
            a.where = { ...(a.where as Json), organizationId };
            break;
          default:
            // Raw queries and anything unknown can't be scoped: refuse.
            throw new ApiError(500, "UNSCOPED_QUERY", `Operation ${operation} is not allowed on the tenant client`);
        }
        return query(a);
      },
    },
  },
});
