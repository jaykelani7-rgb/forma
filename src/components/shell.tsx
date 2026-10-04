"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ArrowLeft, ArrowRight, BarChart3, BookOpen, CalendarDays, CircleHelp, Leaf, Moon, Settings2, Sun, RotateCcw, Plus, ShieldCheck } from "lucide-react";
import { useState, type ReactNode } from "react";
import { BRAND } from "@/lib/model";
import { useWorkspace } from "./provider";
import { AddProblem } from "./problem-form";
import { Modal } from "./ui";

const navigation=[{href:"/",label:"Today",icon:CalendarDays},{href:"/problems",label:"Problems",icon:BookOpen},{href:"/revisit",label:"Revisit",icon:RotateCcw},{href:"/progress",label:"Progress",icon:BarChart3}];
export function BrandMark({ small=false }: {small?:boolean}) {
  return <svg viewBox="0 0 32 36" width={small?25:30} height={small?28:34} fill="none" aria-hidden="true"><path d="M5 31V8.5C5 5.5 8 3 11 3H27V10H13V17H23V24H13V31H5Z" fill="currentColor"/><path d="M17 28V33H27V28H17Z" fill="currentColor" opacity=".45"/></svg>;
}
export function Shell({children}:{children:ReactNode}) {
  const path=usePathname();
  const {data,ready,mode,resolvedTheme,setTheme,setMode,addOpen,setAddOpen,storageError}=useWorkspace();
  const [help,setHelp]=useState(false);
  const focused=path==="/session";
  return <>
    {!focused && <aside className="sidebar">
      <Link href="/" className="brand" aria-label={`${BRAND} home`}><BrandMark/><span>{BRAND.toLowerCase()}<span className="brand-period">.</span></span></Link>
      <div className="sidebar-caption">A PRACTICE IN PROGRESS</div>
      <nav aria-label="Primary navigation">{navigation.map(({href,label,icon:Icon})=><Link key={href} href={href} aria-current={path===href?"page":undefined} className={`nav-link ${path===href?"active":""}`}><Icon size={19} strokeWidth={1.65}/><span>{label}</span>{path===href && <span className="nav-dot"/>}</Link>)}</nav>
      <button className="add-rail" onClick={()=>setAddOpen(true)}><Plus size={17}/>Add a problem</button>
      <div className="sidebar-note"><Leaf size={21} strokeWidth={1.4}/><p>Progress grows<br/>with practice.</p><span>A little, often.</span></div>
      <div className="sidebar-bottom"><button className="nav-link" onClick={()=>setTheme(resolvedTheme==="dark"?"light":"dark")}><span className="theme-icon">{resolvedTheme==="dark"?<Sun size={19}/>:<Moon size={19}/>}</span><span>{resolvedTheme==="dark"?"Light appearance":"Dark appearance"}</span></button><Link href="/settings" className={`nav-link ${path==="/settings"?"active":""}`} aria-current={path==="/settings"?"page":undefined}><Settings2 size={19} strokeWidth={1.65}/><span>Settings</span></Link><div className="profile"><span className="avatar">{(data.settings.displayName||"You")[0].toUpperCase()}</span><div><strong>{data.settings.displayName||"Your workspace"}</strong><span>{mode==="demo"?"Exploring the demo":"Stored on this device"}</span></div><ShieldCheck size={16} className="muted"/></div></div>
    </aside>}
    <div className={focused?"focus-shell":"workspace-shell"}>
      {!focused && <><div className="mobile-top"><Link href="/" className="brand"><BrandMark small/><span>{BRAND.toLowerCase()}.</span></Link><div><button className="icon-button" onClick={()=>setTheme(resolvedTheme==="dark"?"light":"dark")} aria-label="Toggle theme">{resolvedTheme==="dark"?<Sun size={19}/>:<Moon size={19}/>}</button><Link href="/settings" className="icon-button" aria-label="Settings"><Settings2 size={19}/></Link></div></div><div className="topbar"><div className="breadcrumb">Your workspace<span>/</span><strong>{navigation.find(n=>n.href===path)?.label??(path==="/activity"?"Activity":"Settings")}</strong></div><div className="topbar-right"><span className="local-indicator"><span/>A space to get better</span><button className="icon-button" onClick={()=>setHelp(true)} aria-label="About this workspace"><CircleHelp size={18} strokeWidth={1.5}/></button></div></div></>}
      {mode==="demo" && <div className="demo-banner"><span><span className="demo-label">DEMO</span>You’re exploring sample practice. Make yourself at home.</span><button onClick={()=>setMode("personal")}>Go to my workspace<ArrowRight size={15}/></button></div>}
      {storageError && <div className="storage-banner" role="status">{storageError}</div>}
      {ready ? <main id="main-content" className={focused?"focus-main":"main-content"}>{children}</main> : <main className="main-content loading-state" aria-busy="true"><BrandMark/><p>Opening your workspace…</p></main>}
      {!focused && <><footer className="page-footer"><span>Small steps. Lasting understanding.</span><span>{BRAND} · Made for your own pace<Leaf size={13}/></span></footer><nav className="mobile-nav" aria-label="Mobile navigation">{navigation.map(({href,label,icon:Icon})=><Link key={href} href={href} className={path===href?"active":""} aria-current={path===href?"page":undefined}><Icon size={20}/><span>{label}</span></Link>)}</nav></>}
    </div>
    {addOpen && <AddProblem onClose={()=>setAddOpen(false)}/>}
    {help && <Modal title="A space for steady progress." onClose={()=>setHelp(false)}><div className="about-content"><p>{BRAND} is your personal training notebook. Choose a problem, work in your own editor, and leave a quick reflection.</p><p>Your records stay in this browser. A connected Codeforces handle imports public activity when you refresh; your reflections and notebook stay on this device. Export a backup in Settings whenever you need one.</p><div className="rule-note"><Leaf size={20}/><p>Revisit dates follow your configurable reflection defaults. Independent revisits move to 7, 14, then 28–30 days. You can reschedule or retire any revisit.</p></div><button className="button primary" onClick={()=>setHelp(false)}>Make myself at home<ArrowRight size={16}/></button></div></Modal>}
  </>;
}
export function FocusBack() { return <Link href="/" className="text-link"><ArrowLeft size={16}/>Back to Today</Link>; }
