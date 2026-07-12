import { createClient } from "@supabase/supabase-js";

export function getSupabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required");
  }
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export const STORAGE_BUCKET = process.env.S3_BUCKET || "atlas-documents";

export async function uploadPdf(orgId: string, filename: string, bytes: Buffer) {
  const supabase = getSupabaseAdmin();
  const key = `orgs/${orgId}/documents/${crypto.randomUUID()}/${filename}`;
  const { error } = await supabase.storage.from(STORAGE_BUCKET).upload(key, bytes, {
    contentType: "application/pdf",
    upsert: false,
  });
  if (error) throw new Error(error.message);
  return key;
}

export async function downloadPdf(key: string): Promise<Buffer> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase.storage.from(STORAGE_BUCKET).download(key);
  if (error || !data) throw new Error(error?.message || "File not found");
  return Buffer.from(await data.arrayBuffer());
}
