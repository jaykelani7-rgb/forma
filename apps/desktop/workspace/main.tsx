import { createRoot } from "react-dom/client";
import { WorkspaceProvider } from "@/components/provider";
import { Shell } from "@/components/shell";
import { Today } from "@/components/today";
import { Problems } from "@/components/problems";
import { LearningMemory } from "@/components/learning-memory";
import { Tracks } from "@/components/tracks";
import { ContestLab } from "@/components/contest-lab";
import { RibbonJournal } from "@/components/ribbon-journal";
import { CodeforcesActivity } from "@/components/codeforces";
import { Progress } from "@/components/progress";
import { Revisit } from "@/components/revisit";
import { FocusedSession } from "@/components/session";
import { Settings } from "@/components/settings";
import { WebRehearsal } from "@/components/web-ribbon-settings";
import { desktopWorkspace } from "@/lib/desktop-workspace";
import { navigate, useWorkspaceLocation } from "./navigation";
import "@/app/globals.css";
import "@/app/ribbon.css";
import "../../../packages/ribbon/studio.css";
import "./workspace.css";

function Routes() {
  const url = new URL(useWorkspaceLocation(), "https://workspace.local");
  const [section, id, detail, stageId] = url.pathname.slice(1).split("/").map(segment => {
    try { return decodeURIComponent(segment); } catch { return segment; }
  });
  const query = url.searchParams;
  switch (section) {
    case "": case "today": return <Today />;
    case "problems": return id ? <LearningMemory key={`${id}:${query.get("revision")}:${query.get("profile")}`} problemId={id}
      from={query.get("from") ?? undefined} initialRevision={query.get("revision") ?? undefined}
      profile={query.getAll("profile").join(",") || undefined} /> : <Problems />;
    case "tracks": return id !== "shared" ? <Tracks trackId={id} stageId={detail === "stages" ? stageId : undefined} /> : <Unavailable />;
    case "contests": return <ContestLab contestId={id} />;
    case "journal": return <RibbonJournal />;
    case "activity": return <CodeforcesActivity />;
    case "progress": return <Progress />;
    case "revisit": return <Revisit />;
    case "session": return <FocusedSession />;
    case "settings": return <Settings />;
    case "rehearsal": return <WebRehearsal fromSettings={query.get("from") === "settings"} />;
    default: return <Unavailable />;
  }
}

function Unavailable() {
  return <section className="empty-state"><h1>This page isn’t in the workspace</h1>
    <button className="button" onClick={() => navigate("/")}>Back to Today</button></section>;
}

const bridge = desktopWorkspace();
bridge?.onNavigate(path => navigate(path));
createRoot(document.getElementById("root")!).render(bridge ? <WorkspaceProvider>
  <a className="skip-link" href="#main-content" onClick={event => {
    event.preventDefault();
    document.getElementById("main-content")?.focus();
  }}>Skip to content</a>
  <Shell><Routes /></Shell>
</WorkspaceProvider> : <main><h1>Open the Forma app</h1><p>The desktop workspace needs its local notebook connection.</p></main>);
