import { Link, useLocation, useNavigate } from "@tanstack/react-router";
import { ShieldCheck, LayoutDashboard, ClipboardList, Settings2, ScrollText, LogOut } from "lucide-react";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";

const nav = [
  { to: "/dashboard", label: "Elections", icon: LayoutDashboard },
  { to: "/results", label: "Results", icon: ClipboardList },
  { to: "/admin", label: "Administration", icon: Settings2 },
  { to: "/audit", label: "Audit log", icon: ScrollText },
] as const;

export function AppShell({ children }: { children: React.ReactNode }) {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  async function signOut() {
    await supabase.auth.signOut();
    navigate({ to: "/login" });
  }
  return (
    <div className="flex min-h-screen bg-background text-foreground">
      <aside className="hidden w-64 shrink-0 flex-col bg-sidebar text-sidebar-foreground md:flex">
        <div className="flex items-center gap-2 px-6 py-6">
          <div className="flex h-9 w-9 items-center justify-center rounded-md bg-sidebar-primary text-sidebar-primary-foreground">
            <ShieldCheck className="h-5 w-5" />
          </div>
          <div>
            <p className="text-sm font-semibold leading-tight">SEVS</p>
            <p className="text-xs text-sidebar-foreground/70">Secure voting</p>
          </div>
        </div>
        <nav className="mt-2 flex-1 px-3">
          {nav.map((item) => {
            const active = pathname.startsWith(item.to);
            const Icon = item.icon;
            return (
              <Link
                key={item.to}
                to={item.to}
                className={cn(
                  "mb-1 flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                  active
                    ? "bg-sidebar-accent text-sidebar-accent-foreground"
                    : "text-sidebar-foreground/80 hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground",
                )}
              >
                <Icon className="h-4 w-4" />
                {item.label}
              </Link>
            );
          })}
        </nav>
        <div className="border-t border-sidebar-border p-4">
          <div className="mb-3 flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-sidebar-accent text-sm font-semibold">
              AO
            </div>
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">Amelia Okafor</p>
              <p className="truncate text-xs text-sidebar-foreground/60">Voter · #41922</p>
            </div>
          </div>
          <button
            onClick={signOut}
            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs text-sidebar-foreground/70 hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground"
          >
            <LogOut className="h-3.5 w-3.5" /> Sign out
          </button>
        </div>
      </aside>


      <main className="flex-1 overflow-x-hidden">
        <header className="flex items-center justify-between border-b border-border bg-card/60 px-6 py-3 backdrop-blur md:px-10">
          <div className="md:hidden flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-primary" />
            <span className="text-sm font-semibold">SEVS</span>
          </div>
          <div className="ml-auto flex items-center gap-2 text-xs text-muted-foreground">
            <span className="inline-flex h-2 w-2 rounded-full bg-success" />
            Connection verified · TLS 1.3
          </div>
        </header>
        <div className="px-6 py-8 md:px-10 md:py-10">{children}</div>
      </main>
    </div>
  );
}
