import { Outlet, NavLink, useNavigate } from "react-router-dom";
import {
  LayoutDashboard,
  Boxes,
  Activity,
  ScrollText,
  FolderOpen,
  LogOut,
  Server,
  ClipboardList,
  Users,
  ShieldCheck,
  Network,
  HardDrive,
  ImageIcon,
  KeyRound,
} from "lucide-react";
import { toast } from "sonner";
import { logout } from "@/api/auth";
import { useAuthStore } from "@/store/auth";
import { useQueryClient } from "@tanstack/react-query";
import { cn } from "@/lib/utils";

const navItems = [
  { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard, permission: "view_dashboard" },
  {
    to: "/projects", label: "Projects", icon: Boxes, permission: null,
    children: [
      { to: "/volumes",  label: "Volumes",  icon: HardDrive },
      { to: "/networks", label: "Networks", icon: Network },
      { to: "/images",   label: "Images",   icon: ImageIcon },
    ],
  },
  { to: "/system",    label: "System",     icon: Activity,       permission: "view_system" },
  { to: "/logs",      label: "Logs",       icon: ScrollText,     permission: "view_logs" },
  { to: "/files",     label: "Files",      icon: FolderOpen,     permission: "view_files" },
  { to: "/audit",     label: "Audit Logs", icon: ClipboardList,  permission: "view_audit" },
  { to: "/users",      label: "Users",      icon: Users,      permission: null, adminOnly: true },
  { to: "/roles",      label: "Roles",      icon: ShieldCheck, permission: null, adminOnly: true },
  { to: "/registries", label: "Registries", icon: KeyRound,   permission: null, adminOnly: true },
];

export function AppLayout() {
  const navigate = useNavigate();
  const username = useAuthStore((s) => s.username);
  const isAdmin = useAuthStore((s) => s.isAdmin);
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const qc = useQueryClient();

  async function handleLogout() {
    try {
      await logout();
      qc.clear();
      navigate("/login");
    } catch {
      toast.error("Logout failed");
    }
  }

  const visibleItems = navItems.filter((item) => {
    if (item.adminOnly) return isAdmin;
    if (item.permission) return hasPermission(item.permission);
    return true;
  });

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      {/* Sidebar */}
      <aside className="flex w-52 shrink-0 flex-col border-r border-border bg-[var(--sidebar)]">
        {/* Brand */}
        <div className="flex items-center gap-2.5 px-4 py-4 border-b border-border">
          <div className="flex size-7 items-center justify-center rounded bg-primary/10 ring-1 ring-primary/30">
            <Server className="size-3.5 text-primary" />
          </div>
          <span className="text-sm font-semibold tracking-tight">VPS Manager</span>
        </div>

        {/* Nav */}
        <nav className="flex-1 overflow-y-auto py-3 px-2">
          <ul className="space-y-0.5">
            {visibleItems.map(({ to, label, icon: Icon, adminOnly, children }, idx, arr) => {
              const prevAdminOnly = idx > 0 ? arr[idx - 1].adminOnly : false;
              const showDivider = adminOnly && !prevAdminOnly;
              return (
                <li key={to}>
                  {showDivider && <div className="my-2 border-t border-border" />}
                  <NavLink
                    to={to}
                    end={!!children}
                    className={({ isActive }) =>
                      cn(
                        "flex items-center gap-2.5 rounded px-3 py-2 text-sm transition-colors",
                        isActive
                          ? "bg-primary/10 text-primary font-medium"
                          : "text-muted-foreground hover:text-foreground hover:bg-secondary"
                      )
                    }
                  >
                    {({ isActive }) => (
                      <>
                        <Icon className={cn("size-4 shrink-0", isActive && "text-primary")} />
                        {label}
                      </>
                    )}
                  </NavLink>
                  {/* Static sub-items */}
                  {children && (
                    <ul className="mt-0.5 space-y-0.5 pl-6">
                      {children.map(({ to: subTo, label: subLabel, icon: SubIcon }) => (
                        <li key={subTo}>
                          <NavLink
                            to={subTo}
                            className={({ isActive }) =>
                              cn(
                                "flex items-center gap-2 rounded px-2 py-1.5 text-xs transition-colors",
                                isActive
                                  ? "bg-primary/10 text-primary font-medium"
                                  : "text-muted-foreground hover:text-foreground hover:bg-secondary"
                              )
                            }
                          >
                            {({ isActive }) => (
                              <>
                                <SubIcon className={cn("size-3 shrink-0", isActive && "text-primary")} />
                                {subLabel}
                              </>
                            )}
                          </NavLink>
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              );
            })}
          </ul>
        </nav>

        {/* Footer */}
        <div className="border-t border-border p-2">
          <div className="flex items-center gap-2 px-3 py-1.5 mb-1">
            <div className="size-6 rounded-full bg-primary/15 flex items-center justify-center text-primary text-xs font-bold uppercase">
              {username?.[0] ?? "?"}
            </div>
            <span className="text-xs text-muted-foreground truncate">{username}</span>
          </div>
          <button
            onClick={handleLogout}
            className="flex w-full items-center gap-2.5 rounded px-3 py-2 text-sm text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
          >
            <LogOut className="size-4 shrink-0" />
            Sign out
          </button>
        </div>
      </aside>

      {/* Main */}
      <div className="flex flex-1 flex-col overflow-hidden">
        <main className="flex-1 overflow-auto p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
