import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { getAccessToken } from "@/lib/auth-cookies";
import { apiFetch, type MeResponse } from "@/lib/api";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const token = await getAccessToken();
  if (!token) redirect("/login");

  let me: MeResponse | null = null;
  try {
    me = await apiFetch<MeResponse>("/auth/me", { token });
  } catch {
    redirect("/login");
  }

  return (
    <AppShell orgName={me?.organization.name} userName={me?.user.full_name}>
      {children}
    </AppShell>
  );
}
