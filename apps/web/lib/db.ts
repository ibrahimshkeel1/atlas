import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

const url = process.env.DATABASE_URL;
if (!url) {
  console.warn("DATABASE_URL is not set — Atlas API routes will fail until configured");
}

const client = postgres(url || "postgresql://localhost:5432/atlas", {
  prepare: false, // required for Supabase transaction pooler
  ssl: "require",
  max: 5,
});

export const db = drizzle(client, { schema });
