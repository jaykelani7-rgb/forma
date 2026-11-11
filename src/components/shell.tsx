"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  ArrowLeft,
  ArrowRight,
  Activity,
  BookMarked,
  BookOpen,
  CalendarDays,
  CircleHelp,
  Leaf,
  Moon,
  Settings2,
  Sun,
  Plus,
  ShieldCheck,
  Layers3,
  Timer,
} from "lucide-react";
import { useState, type ReactNode } from "react";
import { BRAND } from "@/lib/model";
import { desktopWorkspace } from "@/lib/desktop-workspace";
import { useWorkspace } from "./provider";
import { AddProblem } from "./problem-form";
import { Modal } from "./ui";
import { RibbonFlight } from "./ribbon-flight";
import { RibbonDock } from "./ribbon-dock";
import { RibbonMark } from "../../packages/ribbon/RibbonMark";

const navigation = [
  { href: "/", label: "Today", icon: CalendarDays },
  { href: "/problems", label: "Practice", icon: BookOpen },
  { href: "/tracks", label: "Tracks", icon: Layers3 },
  { href: "/contests", label: "Contests", icon: Timer },
  { href: "/journal", label: "Journal", icon: BookMarked },
];
const practiceTabs = [
  { href: "/problems", label: "Problems" },
  { href: "/revisit", label: "Revisit" },
];
const journalTabs = [
  { href: "/journal", label: "Entries" },
  { href: "/activity", label: "Activity" },
  { href: "/progress", label: "Progress" },
];
export function BrandMark({ small = false }: { small?: boolean }) {
  return <RibbonMark size={small ? 36 : 45} />;
}
export function OpenRibbonButton() {
  const bridge = desktopWorkspace();
  if (!bridge) return null;
  return <button className="icon-button" aria-label="Open Ribbon" title="Open Ribbon" onClick={() => void bridge.openRibbon()}>
    <Activity size={18} strokeWidth={1.6} aria-hidden="true" />
  </button>;
}
export function Shell({ children }: { children: ReactNode }) {
  const path = usePathname();
  const onToday = path === "/" || path === "/today";
  const sectionPath = onToday ? "/" : "/" + (path.split("/")[1] ?? "");
  const activePath =
    sectionPath === "/revisit"
      ? "/problems"
      : journalTabs.some((tab) => tab.href === sectionPath)
        ? "/journal"
        : sectionPath;
  const sectionTabs =
    path === "/problems" || path === "/revisit"
      ? practiceTabs
      : journalTabs.some((tab) => tab.href === path)
        ? journalTabs
        : [];
  const {
    data,
    todayHref,
    ready,
    mode,
    resolvedTheme,
    setTheme,
    setMode,
    addOpen,
    setAddOpen,
    storageError,
    storagePending,
    account,
    cloudStatus,
  } = useWorkspace();
  const [help, setHelp] = useState(false);
  const focused = path === "/session";
  return (
    <>
      {!focused && (
        <aside className="sidebar">
          <Link href={todayHref} className="brand" aria-label={`${BRAND} home`}>
            <BrandMark />
            <span>{BRAND.toLowerCase()}</span>
          </Link>

          <nav aria-label="Primary navigation">
            {navigation.map(({ href, label, icon: Icon }) => (
              <Link
                key={href}
                href={href === "/" ? todayHref : href}
                aria-current={activePath === href ? "page" : undefined}
                className={`nav-link ${activePath === href ? "active" : ""}`}
              >
                <Icon size={19} strokeWidth={1.65} />
                <span>{label}</span>
                {activePath === href && <span className="nav-dot" />}
              </Link>
            ))}
          </nav>
          <button className="add-rail" onClick={() => setAddOpen(true)}>
            <Plus size={17} />
            Add a problem
          </button>
          <div className="sidebar-bottom">
            <button
              className="nav-link"
              onClick={() =>
                setTheme(resolvedTheme === "dark" ? "light" : "dark")
              }
            >
              <span className="theme-icon">
                {resolvedTheme === "dark" ? (
                  <Sun size={19} />
                ) : (
                  <Moon size={19} />
                )}
              </span>
              <span>
                {resolvedTheme === "dark"
                  ? "Light appearance"
                  : "Dark appearance"}
              </span>
            </button>
            <Link
              href="/settings"
              className={`nav-link ${path === "/settings" ? "active" : ""}`}
              aria-current={path === "/settings" ? "page" : undefined}
            >
              <Settings2 size={19} strokeWidth={1.65} />
              <span>Settings</span>
            </Link>
            <div className="profile">
              <span className="avatar">
                {(data.settings.displayName || "You")[0].toUpperCase()}
              </span>
              <div>
                <strong>{data.settings.displayName || "Your workspace"}</strong>
                <span>
                  {mode === "demo"
                    ? "Exploring the demo"
                    : account
                      ? `Account · ${cloudStatus}`
                      : "Stored on this device"}
                </span>
              </div>
              <ShieldCheck size={16} className="muted" />
            </div>
          </div>
        </aside>
      )}
      <div className={focused ? "focus-shell" : "workspace-shell"}>
        {!focused && (
          <>
            <div className="mobile-top">
              <Link href={todayHref} className="brand">
                <BrandMark small />
                <span>{BRAND.toLowerCase()}</span>
              </Link>
              <div>
                <OpenRibbonButton />
                <button
                  className="icon-button"
                  onClick={() =>
                    setTheme(resolvedTheme === "dark" ? "light" : "dark")
                  }
                  aria-label="Toggle theme"
                >
                  {resolvedTheme === "dark" ? (
                    <Sun size={19} />
                  ) : (
                    <Moon size={19} />
                  )}
                </button>
                <Link
                  href="/settings"
                  className="icon-button"
                  aria-label="Settings"
                >
                  <Settings2 size={19} />
                </Link>
              </div>
            </div>
            <div className={onToday ? "topbar ribbon-home-bar" : "topbar"}>
              <div className="breadcrumb">
                Your workspace<span>/</span>
                <strong>
                  {navigation.find((n) => n.href === activePath)?.label ??
                    (path === "/rehearsal"
                      ? "Rehearsal"
                      : path === "/handoff"
                        ? "Handoff"
                        : "Settings")}
                </strong>
              </div>
              <div className="topbar-right">
                <span className="local-indicator">
                  <span />
                  {mode === "demo"
                    ? "Demo workspace"
                    : account
                      ? `Account · ${cloudStatus}`
                      : "On this device"}
                </span>
                <OpenRibbonButton />
                <button
                  className="icon-button"
                  onClick={() => setHelp(true)}
                  aria-label="About this workspace"
                >
                  <CircleHelp size={18} strokeWidth={1.5} />
                </button>
              </div>
            </div>
          </>
        )}
        {mode === "demo" && (
          <div className="demo-banner">
            <span>
              <span className="demo-label">DEMO</span>You’re exploring sample
              practice. Make yourself at home.
            </span>
            <button onClick={() => setMode("personal")}>
              Go to my workspace
              <ArrowRight size={15} />
            </button>
          </div>
        )}
        {storagePending && (
          <div className="storage-save-status" role="status">
            Saving local changes…
          </div>
        )}
        {storageError && (
          <div className="storage-banner" role="status">
            {storageError}
          </div>
        )}
        {ready ? (
          <main
            id="main-content"
            tabIndex={-1}
            className={focused ? "focus-main" : "main-content"}
          >
            {sectionTabs.length > 0 && (
              <nav
                className="ribbon-section-tabs"
                aria-label="Section navigation"
              >
                {sectionTabs.map((tab) => (
                  <Link
                    key={tab.href}
                    href={tab.href}
                    aria-current={path === tab.href ? "page" : undefined}
                  >
                    {tab.label}
                  </Link>
                ))}
              </nav>
            )}
            {children}
          </main>
        ) : (
          <main className="main-content loading-state" aria-busy="true">
            <BrandMark />
            <p>Opening your workspace…</p>
          </main>
        )}
        {!focused && (
          <>
            <footer className="page-footer">
              <span>Small steps. Lasting understanding.</span>
              <span>
                {BRAND} · Made for your own pace
                <Leaf size={13} />
              </span>
            </footer>
            <nav className="mobile-nav" aria-label="Mobile navigation">
              {navigation.map(({ href, label, icon: Icon }) => (
                <Link
                  key={href}
                  href={href}
                  className={activePath === href ? "active" : ""}
                  aria-current={activePath === href ? "page" : undefined}
                >
                  <Icon size={20} />
                  <span>{label}</span>
                </Link>
              ))}
            </nav>
          </>
        )}
      </div>
      <RibbonFlight path={path} />
      {!focused && ready && data.session && <RibbonDock />}
      {addOpen && <AddProblem onClose={() => setAddOpen(false)} />}
      {help && (
        <Modal
          title="A space for steady progress."
          onClose={() => setHelp(false)}
        >
          <div className="about-content">
            <p>
              {BRAND} is your personal training notebook. Choose a problem, work
              in your own editor, and leave a quick reflection.
            </p>
            <p>
              {account && mode !== "demo"
                ? "This account has a separate device cache. Check sync and recovery in Settings."
                : "This workspace is stored in this browser. Export a backup in Settings to keep a copy."}
            </p>
            <div className="rule-note">
              <Leaf size={20} />
              <p>
                Revisit dates follow your configurable reflection defaults.
                Independent revisits move to 7, 14, then 28–30 days. You can
                reschedule or retire any revisit.
              </p>
            </div>
            <button className="button primary" onClick={() => setHelp(false)}>
              Make myself at home
              <ArrowRight size={16} />
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}
export function FocusBack() {
  const { todayHref } = useWorkspace();
  const back = <Link href={todayHref} className="text-link">
      <ArrowLeft size={16} />
      Back to Today
    </Link>;
  return desktopWorkspace() ? <div className="focus-header-actions"><OpenRibbonButton />{back}</div> : back;
}
