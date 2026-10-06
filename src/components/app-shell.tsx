"use client";

import { FolderKanban, LayoutDashboard, LogOut, Menu, ReceiptText, Settings, Users, Wallet } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { logoutAction } from "@/app/login/actions";
import { ProductName } from "@/components/brand";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

const NAV = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/proyectos", label: "Proyectos", icon: FolderKanban },
  { href: "/facturas", label: "Facturas y recaudos", icon: ReceiptText },
  { href: "/colaboradores", label: "Colaboradores", icon: Users },
  { href: "/liquidaciones", label: "Liquidaciones", icon: Wallet },
  { href: "/configuracion", label: "Configuración", icon: Settings },
] as const;

function NavList({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Principal" className="flex flex-col gap-1">
      {NAV.map(({ href, label, icon: Icon }) => {
        const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
        return (
          <Link
            key={href}
            href={href}
            onClick={onNavigate}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex items-center gap-3 border-l-2 px-3 py-2.5 text-sm font-medium transition-colors",
              active
                ? "border-brand-mint bg-sidebar-accent text-white"
                : "border-transparent text-sidebar-foreground/75 hover:bg-sidebar-accent/60 hover:text-white",
            )}
          >
            <Icon className="size-[18px] shrink-0" aria-hidden />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}

function SidebarBody({ user, onNavigate }: { user: { name: string; email: string }; onNavigate?: () => void }) {
  return (
    <div className="flex h-full flex-col bg-sidebar text-sidebar-foreground">
      <div className="px-6 pt-7 pb-8">
        <ProductName tone="light" />
      </div>
      <div className="flex-1 px-3">
        <NavList onNavigate={onNavigate} />
      </div>
      <div className="border-t border-sidebar-border p-4">
        <p className="truncate text-sm font-semibold text-white">{user.name}</p>
        <p className="truncate text-xs text-white/50">{user.email}</p>
        <form action={logoutAction} className="mt-3">
          <button
            type="submit"
            className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.1em] text-white/70 transition-colors hover:text-white"
          >
            <LogOut className="size-3.5" aria-hidden /> Cerrar sesión
          </button>
        </form>
      </div>
    </div>
  );
}

export function AppShell({ user, children }: { user: { name: string; email: string }; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[256px_1fr]">
      <aside className="sticky top-0 hidden h-screen lg:block">
        <SidebarBody user={user} />
      </aside>

      <div className="flex min-w-0 flex-col">
        <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b bg-background/95 px-4 backdrop-blur lg:hidden">
          <button
            type="button"
            onClick={() => setOpen(true)}
            aria-label="Abrir menú"
            className="-ml-1 grid size-9 place-items-center text-brand-deep hover:bg-muted"
          >
            <Menu className="size-5" />
          </button>
          <ProductName />
        </header>
        <Sheet open={open} onOpenChange={setOpen}>
          <SheetContent side="left" className="w-[280px] gap-0 border-0 p-0" showCloseButton={false}>
            <SheetTitle className="sr-only">Menú principal</SheetTitle>
            <SidebarBody user={user} onNavigate={() => setOpen(false)} />
          </SheetContent>
        </Sheet>

        <main className="mx-auto w-full max-w-[1400px] flex-1 px-4 py-6 sm:px-8 sm:py-9">{children}</main>
      </div>
    </div>
  );
}
