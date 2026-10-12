"use client";

import React, { createContext, useContext, useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { supabase } from "../supabaseClient.js";
import { fetchStaffScope, signOutSupabase } from "../utils/scope.js";
import { installWriteGuard, setActiveScope } from "../utils/writeGuard.js";
import { getEffectiveTheme, toggleTheme } from "../utils/theme.js";
import { ToastContainer, toast } from "react-toastify";
import "react-toastify/dist/ReactToastify.css";
import {
  RiDashboardLine,
  RiSchoolLine,
  RiGroupLine,
  RiBarChartBoxLine,
  RiQuestionAnswerLine,
  RiBookOpenLine,
  RiFileTextLine,
  RiInboxLine,
  RiDraftLine,
  RiTimeLine,
  RiUserLine,
  RiLogoutBoxRLine,
  RiMenuLine,
  RiShieldCrossLine,
  RiLockLine,
  RiMessage2Line,
  RiSunLine,
  RiMoonLine,
  RiTeamLine,
  RiPriceTagLine,
} from "react-icons/ri";
import "../styles/AdminPages.css";
import "../styles/StaffShell.css";

// React context so every page can read the signed-in staff member + scope
// without re-fetching (fetch happens once here in the shell).
export const StaffContext = createContext(null);
export const useStaff = () => useContext(StaffContext);

const NAV = [
  { href: "/home", label: "Dashboard", icon: RiDashboardLine },
  { href: "/classes", label: "My Classes", icon: RiSchoolLine, hideForRecords: true },
  { href: "/students", label: "Students", icon: RiGroupLine, need: "formTeacher" },
  { href: "/results", label: "Results", icon: RiBarChartBoxLine, need: "teaching" },
  { href: "/cbt_questions", label: "CBT Questions", icon: RiQuestionAnswerLine, need: "teaching" },
  { href: "/notes", label: "E-Notes", icon: RiBookOpenLine, need: "teaching" },
  { href: "/assignments", label: "Assignments", icon: RiFileTextLine, need: "teaching" },
  { href: "/submissions", label: "Submissions", icon: RiInboxLine, need: "teaching" },
  { href: "/lesson_plans", label: "Lesson Plans", icon: RiDraftLine, need: "teaching" },
  { href: "/announcements", label: "Announcements", icon: RiShieldCrossLine },
  { href: "/chat", label: "Messages", icon: RiMessage2Line },
  { href: "/attendance", label: "Class Attendance", icon: RiTimeLine, need: "formTeacher" },
  { href: "/profile", label: "My Profile", icon: RiUserLine },
];

// School-wide, read-only Records datasets — each its own sidebar button, shown
// only to admin/secretarial designations (scope.recordsAccess). Kept separate
// from the teacher NAV above so teachers never see them and secretaries never
// see the editable teacher surfaces.
const RECORDS_NAV = [
  { href: "/records/staff", label: "Staff Records", icon: RiTeamLine },
  { href: "/records/students", label: "Student Records", icon: RiGroupLine },
  { href: "/records/payments", label: "Payments", icon: RiPriceTagLine },
  { href: "/records/attendance", label: "Attendance", icon: RiTimeLine },
  { href: "/records/results", label: "Results", icon: RiBarChartBoxLine },
  { href: "/records/lesson_plans", label: "Lesson Plans", icon: RiDraftLine },
  { href: "/records/cbt", label: "CBT Questions", icon: RiQuestionAnswerLine },
  { href: "/records/notes", label: "E-Notes", icon: RiBookOpenLine },
  { href: "/records/assignments", label: "Assignments", icon: RiFileTextLine },
];

export default function StaffShell({ children }) {
  const [state, setState] = useState({ phase: "checking" }); // checking | ready | blocked | suspended | nostaff | signedout
  const [scope, setScope] = useState(null);
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [theme, setTheme] = useState("light");
  // True when this tab was opened by an admin via "Sign in as Staff" — the
  // /impersonate landing sets this sessionStorage flag before handing off here.
  const [impersonating, setImpersonating] = useState(false);
  const pathname = usePathname();
  const router = useRouter();

  // Reflect the current theme on the toggle icon (data-theme is set before
  // paint by the pre-paint script in app/layout.jsx; we only read it here).
  useEffect(() => {
    setTheme(getEffectiveTheme());
  }, []);
  const onToggleTheme = () => setTheme(toggleTheme());

  useEffect(() => {
    try {
      setImpersonating(sessionStorage.getItem("jmis_impersonating") === "1");
    } catch {
      /* ignore */
    }
  }, []);

  // Track mobile viewport: below 800px the sidebar becomes an off-canvas
  // drawer opened from the topbar hamburger instead of a permanent rail.
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia("(max-width: 800px)");
    const update = () => setIsMobile(mq.matches);
    update();
    mq.addEventListener?.("change", update);
    return () => mq.removeEventListener?.("change", update);
  }, []);

  // Auto-close the mobile drawer on navigation.
  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  const resolve = useCallback(async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      setState({ phase: "signedout" });
      router.replace("/login");
      return;
    }
    const email = session.user?.email;
    try {
      // match by auth-user id first so the profile keeps resolving after the
      // staff replaces their provisional login email on the Profile page
      const s = await fetchStaffScope(email, session.user?.id);
      if (!s) {
        toast.error("No staff record found for this email. Please use the Admin Dashboard or contact the school office.");
        await signOutSupabase();
        setState({ phase: "signedout" });
        router.replace("/login");
        return;
      }
      if (s.staff.status === "blocked") {
        await signOutSupabase();
        setState({ phase: "blocked" });
        return;
      }
      if (s.staff.status === "suspended") {
        setState({ phase: "suspended", scope: s });
        setScope(s);
        return;
      }
      setScope(s);
      setActiveScope(s);
      installWriteGuard(); // patch supabase writes with the scope guard once
      setState({ phase: "ready" });
    } catch (err) {
      console.error("Scope resolution failed:", err);
      toast.error("Could not load your staff profile. Check your connection and retry.");
      setState({ phase: "error" });
    }
  }, [router]);

  useEffect(() => {
    resolve();
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_OUT") {
        setState({ phase: "signedout" });
        router.replace("/login");
      } else if (event === "SIGNED_IN") {
        resolve();
      }
    });
    return () => sub?.subscription?.unsubscribe();
  }, [resolve, router]);

  const signOut = async () => {
    setActiveScope(null);
    try {
      sessionStorage.removeItem("jmis_impersonating");
    } catch {
      /* ignore */
    }
    await signOutSupabase();
    setState({ phase: "signedout" });
    router.replace("/login");
  };

  // ---------- non-shell screens ----------

  if (state.phase === "checking" || state.phase === "signedout") {
    return (
      <div className="staff-boot">
        <div className="ap-spinner" />
        <p>{state.phase === "checking" ? "Preparing your portal…" : "Signing you out…"}</p>
      </div>
    );
  }

  if (state.phase === "error") {
    return (
      <div className="staff-boot">
        <h4>Something went wrong</h4>
        <button className="staff-login-submit" style={{ maxWidth: 220 }} onClick={resolve}>Retry</button>
      </div>
    );
  }

  if (state.phase === "blocked") {
    return (
      <div className="staff-boot">
        <RiLockLine size={40} color="#e74a3b" />
        <h4>Account blocked</h4>
        <p className="ap-muted text-center">
          Your staff account has been blocked. Please contact the school administrator.
        </p>
        <button className="staff-login-submit" style={{ maxWidth: 220 }} onClick={() => router.replace("/login")}>
          Back to login
        </button>
      </div>
    );
  }

  if (state.phase === "suspended") {
    return (
      <div className="staff-boot">
        <RiLockLine size={40} color="#f6a623" />
        <h4>Account suspended</h4>
        <p className="ap-muted text-center">
          Your account is temporarily suspended — portal features are disabled.
          Contact the school administrator to restore access.
        </p>
        <button className="staff-login-submit" style={{ maxWidth: 220 }} onClick={signOut}>Sign out</button>
      </div>
    );
  }

  // ---------- shell ----------

  const academic = scope.isAcademic !== false; // default: treat as Academic
  const teaching = !scope.isGeneral && academic;
  const items = NAV.filter((n) => {
    if (n.need === "teaching" && !teaching) return false;
    // Student-info surfaces (roster, attendance) are form-teacher only —
    // subject teachers just see student names inside their own Results/CBT.
    if (n.need === "formTeacher" && (!academic || (scope.rosterClasses || []).length === 0)) return false;
    // My Classes is a teaching surface; hidden for read-only Records designations.
    if (n.hideForRecords && scope.recordsAccess) return false;
    return true;
  });
  // Records designations get one read-only button per dataset, appended after
  // the standard nav. Teachers without the designation never see these.
  if (scope.recordsAccess) items.push(...RECORDS_NAV);
  const ctxValue = { ...scope, signOut, reload: resolve };

  const showLabels = isMobile || !collapsed;
  const toggleSidebar = () => (isMobile ? setMobileOpen((o) => !o) : setCollapsed((c) => !c));

  return (
    <StaffContext.Provider value={ctxValue}>
      <div className={"staff-shell" + (collapsed ? " collapsed" : "") + (isMobile && mobileOpen ? " mobile-open" : "")}>
        <ToastContainer position="top-center" />
        {isMobile && mobileOpen && (
          <div className="staff-scrim" onClick={() => setMobileOpen(false)} aria-hidden="true" />
        )}
        <aside className="staff-side">
          <div className="staff-side-head">
            <button className="staff-side-collapse" onClick={toggleSidebar} title={isMobile ? "Close menu" : collapsed ? "Expand sidebar" : "Collapse sidebar"} aria-label="Toggle sidebar">
              <RiMenuLine />
            </button>
          </div>
          <div className="staff-side-brand">
            <img src="/logo.jpg" alt="JMIS" />
            {showLabels && (
              <div>
                <b>Staff Portal</b>
                <span>JMIS School</span>
              </div>
            )}
          </div>
          <nav className="staff-side-nav">
            {items.map(({ href, label, icon: Icon }) => {
              const active = pathname === href || pathname.startsWith(href + "/");
              return (
                <Link key={href} href={href} className={"staff-navitem" + (active ? " active" : "")}>
                  <Icon /> {showLabels && <span>{label}</span>}
                </Link>
              );
            })}
          </nav>
          <div className="staff-side-foot">
            {!academic && showLabels && (
              <p className="staff-general-note">
                Non-academic staff — academic features are disabled for your account.
              </p>
            )}
            {academic && scope.isGeneral && showLabels && (
              <p className="staff-general-note">
                General staff — class features unlock once the admin assigns you a class/subject.
              </p>
            )}
            <button className="staff-signout" onClick={signOut} title="Sign out">
              <RiLogoutBoxRLine /> {showLabels && <span>Sign out</span>}
            </button>
          </div>
        </aside>
        <main className="staff-main">
          <header className="staff-topbar">
            <div className="staff-topbar-left">
              <button className="staff-menu-btn" onClick={() => setMobileOpen(true)} aria-label="Open menu">
                <RiMenuLine />
              </button>
              <div className="staff-topbar-id">
                <b>{scope.staff.name}</b>
                <span className="ap-muted">
                  {scope.staff.staff_no ? `${scope.staff.staff_no} · ` : ""}
                  {scope.staff.designation || "Staff"}
                  {scope.session ? ` · ${scope.session}` : ""}
                </span>
              </div>
            </div>
            <div className="d-flex align-items-center gap-2">
              <button
                className="ap-btn sm ghost"
                onClick={onToggleTheme}
                title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
              >
                {theme === "dark" ? <RiSunLine /> : <RiMoonLine />} {theme === "dark" ? "Light" : "Dark"}
              </button>
              {process.env.NEXT_PUBLIC_WEBSITE_URL && (
                <a className="ap-btn sm ghost staff-website-link" href={process.env.NEXT_PUBLIC_WEBSITE_URL} target="_blank" rel="noopener noreferrer">
                  School website ↗
                </a>
              )}
            </div>
          </header>
          {impersonating && (
            <div
              className="staff-impersonate-banner"
              style={{
                background: "#fff4e5",
                color: "#8a5a00",
                border: "1px solid #f0d9a8",
                borderBottom: "none",
                padding: "8px 16px",
                fontSize: "0.85rem",
                fontWeight: 600,
              }}
            >
              You are viewing as {scope.staff.name} (administrator preview) — actions here create real
              records for this staff member. Close this tab when done.
            </div>
          )}
          <div className="staff-content">{children}</div>
        </main>
      </div>
    </StaffContext.Provider>
  );
}
