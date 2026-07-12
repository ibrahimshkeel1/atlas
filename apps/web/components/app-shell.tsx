"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  FileText,
  ArrowLeftRight,
  BarChart3,
  Settings,
  LogOut,
  Tags,
  CalendarCheck2,
  FolderTree,
  Store,
  FlaskConical,
  ScrollText,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { ClientProvider } from "@/components/client-provider";
import { ClientSwitcher } from "@/components/client-switcher";

const nav = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/documents", label: "Documents", icon: FileText },
  { href: "/transactions", label: "Transactions", icon: ArrowLeftRight },
  { href: "/close", label: "Month close", icon: CalendarCheck2 },
  { href: "/categories", label: "Categories", icon: FolderTree },
  { href: "/merchants", label: "Merchants", icon: Store },
  { href: "/rules", label: "Learning rules", icon: Tags },
  { href: "/reports", label: "Reports", icon: BarChart3 },
  { href: "/audit", label: "Audit log", icon: ScrollText },
  { href: "/eval", label: "Eval", icon: FlaskConical },
  { href: "/settings", label: "Settings", icon: Settings },
];

export function AppShell({
  children,
  orgName,
  userName,
}: {
  children: React.ReactNode;
  orgName?: string;
  userName?: string;
}) {
  const pathname = usePathname();

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.href = "/login";
  }

  return (
    <ClientProvider>
      <div className="min-h-screen lg:grid lg:grid-cols-[240px_1fr]">
        <aside className="flex min-h-screen flex-col border-b border-border/80 bg-white/70 backdrop-blur lg:border-b-0 lg:border-r">
          <div className="flex h-16 items-center gap-2 px-6">
            <div className="flex h-8 w-8 items-center justify-center rounded-md bg-primary text-sm font-semibold text-primary-foreground">
              A
            </div>
            <div>
              <p className="font-display text-lg leading-none tracking-tight">Atlas</p>
              <p className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
                Finance AI
              </p>
            </div>
          </div>

          <div className="border-b border-border/60 bg-muted/20 px-4 py-3">
            <p className="mb-1.5 text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
              Active client
            </p>
            <ClientSwitcher />
          </div>

          <nav className="flex flex-1 gap-1 overflow-x-auto px-3 py-3 lg:flex-col lg:overflow-visible lg:px-3">
            {nav.map((item) => {
              const Icon = item.icon;
              const active = pathname.startsWith(item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    "flex items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors",
                    active
                      ? "bg-accent text-accent-foreground"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground"
                  )}
                >
                  <Icon className="h-4 w-4" />
                  {item.label}
                </Link>
              );
            })}
          </nav>

          <div className="border-t border-border/80 p-4">
            <p className="truncate text-sm font-medium">{userName}</p>
            <p className="truncate text-xs text-muted-foreground">{orgName}</p>
            <p className="mt-1 text-[10px] text-muted-foreground/70">
              build {process.env.NEXT_PUBLIC_BUILD_SHA?.slice(0, 7) || "dev"}
            </p>
            <Button variant="ghost" size="sm" className="mt-3 w-full justify-start" onClick={logout}>
              <LogOut className="h-4 w-4" />
              Sign out
            </Button>
          </div>
        </aside>

        <main className="px-4 py-6 sm:px-8 sm:py-8">{children}</main>
      </div>
    </ClientProvider>
  );
}
