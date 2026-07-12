import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { getAccessToken } from "@/lib/auth-cookies";
import { me } from "@/lib/atlas-api";
import { requireUser } from "@/lib/session";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const token = await getAccessToken();
  if (!token) redirect("/login");

  let orgName: string | undefined;
  let userName: string | undefined;
  try {
    const user = await requireUser();
    const profile = await me(user);
    orgName = profile.organization.name;
    userName = profile.user.full_name;
  } catch {
    redirect("/login");
  }

  return (
    <AppShell orgName={orgName} userName={userName}>
      {children}
    </AppShell>
  );
}
