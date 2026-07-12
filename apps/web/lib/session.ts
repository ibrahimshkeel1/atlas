import { eq } from "drizzle-orm";
import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { users } from "@/lib/schema";
import { getAccessToken } from "@/lib/auth-cookies";
import { getUserIdFromAccessToken } from "@/lib/auth-server";

export type SessionUser = {
  id: string;
  email: string;
  fullName: string;
  organizationId: string;
};

export async function requireUser(req?: NextRequest): Promise<SessionUser> {
  let token: string | undefined;
  const auth = req?.headers.get("authorization");
  if (auth?.startsWith("Bearer ")) {
    token = auth.slice(7);
  } else {
    token = (await getAccessToken()) || undefined;
  }
  if (!token) throw new Error("Unauthorized");

  const userId = await getUserIdFromAccessToken(token);
  const rows = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  const user = rows[0];
  if (!user) throw new Error("Unauthorized");
  return {
    id: user.id,
    email: user.email,
    fullName: user.fullName,
    organizationId: user.organizationId,
  };
}

export function jsonError(message: string, status = 400) {
  return Response.json({ detail: message }, { status });
}
