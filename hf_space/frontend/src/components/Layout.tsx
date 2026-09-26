import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import clsx from "clsx";
import { FolderKanban, LayoutDashboard, LogOut, ScrollText, Settings } from "lucide-react";
import { useAuth } from "@/lib/auth";

export function Logo({ inverted = false }: { inverted?: boolean }) {
  return (
    <div className="flex items-center gap-2.5">
      <div className={clsx("flex h-8 w-8 items-center justify-center rounded-ctl", inverted ? "bg-white/15" : "bg-primary")}>
        <svg viewBox="0 0 32 32" className="h-5 w-5" fill="none">
          <path d="M6 22l6-7 5 5 9-11" stroke="white" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round" />
          <circle cx="26" cy="9" r="2.5" fill="white" />
        </svg>
      </div>
      <span className={clsx("text-[18px] font-semibold tracking-tight", inverted ? "text-white" : "text-ink")}>ImpactTrace</span>
    </div>
  );
}

const NAV = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard, end: true },
  { to: "/projects", label: "Projects", icon: FolderKanban },
  { to: "/audit", label: "Audit log", icon: ScrollText },
  { to: "/settings", label: "Settings", icon: Settings },
];

export default function Layout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const initials = (user?.name || "?").split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase();

  return (
    <div className="flex min-h-full">
      <aside className="fixed inset-y-0 left-0 z-30 flex w-[240px] flex-col border-r border-line bg-white max-[1100px]:w-[72px]">
        <div className="flex h-16 items-center px-5 max-[1100px]:justify-center max-[1100px]:px-0">
          <div className="max-[1100px]:hidden"><Logo /></div>
          <div className="hidden max-[1100px]:block">
            <div className="flex h-8 w-8 items-center justify-center rounded-ctl bg-primary text-[13px] font-bold text-white">IT</div>
          </div>
        </div>
        <nav className="flex-1 space-y-1 px-3 pt-2">
          {NAV.map(({ to, label, icon: Icon, end }) => {
            const active = to === "/projects" ? pathname.startsWith("/projects") : undefined;
            return (
              <NavLink
                key={to}
                to={to}
                end={end}
                title={label}
                className={({ isActive }) => clsx(
                  "flex h-10 items-center gap-3 rounded-ctl px-3 text-[14px] font-medium transition max-[1100px]:justify-center",
                  (active ?? isActive) ? "bg-primary-light text-primary-dark" : "text-muted hover:bg-hover hover:text-ink",
                )}
              >
                <Icon className="h-5 w-5 shrink-0" strokeWidth={1.75} />
                <span className="max-[1100px]:hidden">{label}</span>
              </NavLink>
            );
          })}
        </nav>
        <div className="border-t border-line p-3">
          <div className="flex items-center gap-3 rounded-ctl px-2 py-2 max-[1100px]:justify-center">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary text-[13px] font-semibold text-white">
              {initials}
            </div>
            <div className="min-w-0 flex-1 max-[1100px]:hidden">
              <div className="truncate text-[14px] font-medium">{user?.name}</div>
              <div className="truncate text-[12px] text-muted">{user?.email}</div>
            </div>
            <button
              onClick={() => { logout(); navigate("/login"); }}
              className="rounded-ctl p-1.5 text-muted hover:bg-hover hover:text-ink max-[1100px]:hidden"
              title="Sign out"
              aria-label="Sign out"
            >
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        </div>
      </aside>
      <main className="ml-[240px] min-w-0 flex-1 max-[1100px]:ml-[72px]">
        <Outlet />
      </main>
    </div>
  );
}
