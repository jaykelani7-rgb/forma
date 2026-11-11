import Link from "next/link";
import { ArrowDownToLine, ArrowRight, BookMarked, Clock3, Laptop, ListTodo, Play } from "lucide-react";
import type { ReactNode } from "react";
import { RibbonMark } from "../../packages/ribbon/RibbonMark";
import { MacPreviewSession } from "./mac-preview-session";
import styles from "./mac-site.module.css";

function MacSite({ children, page, releaseAvailable }: {
  children: ReactNode;
  page: "home" | "preview" | "download";
  releaseAvailable: boolean;
}) {
  const home = releaseAvailable ? "/" : "/download";
  return (
    <div className={styles.site}>
      <header className={styles.header}>
        <Link className={styles.brand} href={home} aria-label="Forma home">
          <RibbonMark size={36} />
          <span>forma</span>
        </Link>
        <nav className={styles.navigation} aria-label="Forma">
          <Link href="/preview" aria-current={page === "preview" ? "page" : undefined}>Preview</Link>
          <Link href="/download" aria-current={page === "download" ? "page" : undefined}>Download</Link>
        </nav>
      </header>
      <main id="main-content" className={styles.main}>{children}</main>
      <footer className={styles.footer}>
        <span>Forma</span>
        <nav aria-label="Web notebook">
          <Link href="/today">Open web notebook</Link>
          <Link href="/settings">Export web data</Link>
        </nav>
      </footer>
    </div>
  );
}

function DownloadLink({ href }: { href: string }) {
  return <a className={styles.primary} href={href} referrerPolicy="no-referrer">
    <ArrowDownToLine size={18} aria-hidden="true" /> Download for Mac
  </a>;
}

function PreviewLink({ primary = false }: { primary?: boolean }) {
  return <Link className={primary ? styles.primary : styles.secondary} href="/preview">
    <Play size={16} aria-hidden="true" /> Try the browser demo
  </Link>;
}

export function MacHome({ downloadUrl }: { downloadUrl: string }) {
  return (
    <MacSite page="home" releaseAvailable>
      <section className={styles.hero} aria-labelledby="mac-home-title">
        <p className={styles.label}>Competitive programming · macOS</p>
        <h1 id="mac-home-title">Make time to <em>solve.</em></h1>
        <p className={styles.intro}>Plan what to practice, focus on one problem, and keep the thoughts that will help you solve the next one.</p>
        <div className={styles.actions}>
          <DownloadLink href={downloadUrl} />
          <PreviewLink />
        </div>
        <p className={styles.platform}>For Macs with Apple silicon</p>
      </section>
      <div className={styles.landscape} aria-hidden="true" />
      <section className={styles.features} aria-label="Inside Forma">
        <div><ListTodo size={22} aria-hidden="true" /><h2>Today</h2><p>Choose problems and revisits for the time you have.</p></div>
        <div><Clock3 size={22} aria-hidden="true" /><h2>Ribbon</h2><p>Open a timer and leave a thought while your solution is in front of you.</p></div>
        <div><BookMarked size={22} aria-hidden="true" /><h2>Journal</h2><p>Come back to what you tried, where you got stuck, and what you learned.</p></div>
      </section>
    </MacSite>
  );
}

export function MacPreview({ releaseAvailable }: { releaseAvailable: boolean }) {
  return (
    <MacSite page="preview" releaseAvailable={releaseAvailable}>
      <div className={styles.split}>
        <section aria-labelledby="mac-preview-title">
          <p className={styles.label}>Interactive preview</p>
          <h1 id="mac-preview-title">Try a <em>practice session.</em></h1>
          <p className={styles.intro}>Unfold the Ribbon, start the timer, and bookmark a thought.</p>
          <Link className={styles.textLink} href="/download">
            {releaseAvailable ? "Get Forma for Mac" : "See Mac release details"} <ArrowRight size={16} aria-hidden="true" />
          </Link>
        </section>
        <div className={styles.rehearsal}>
          <MacPreviewSession exitHref={releaseAvailable ? "/" : "/download"} />
        </div>
      </div>
    </MacSite>
  );
}

export function MacDownload({ downloadUrl }: { downloadUrl: string | null }) {
  return (
    <MacSite page="download" releaseAvailable={downloadUrl !== null}>
      <div className={styles.split}>
        <section aria-labelledby="mac-download-title">
          <p className={styles.label}>Apple silicon</p>
          <h1 id="mac-download-title">Forma <em>for Mac.</em></h1>
          <p className={styles.intro}>{downloadUrl ? "Keep your practice plan, timer, and journal together in the desktop app." : "The Mac download will appear here when a release is published."}</p>
          <div className={styles.actions}>
            {downloadUrl && <DownloadLink href={downloadUrl} />}
            <PreviewLink primary={!downloadUrl} />
          </div>
        </section>
        <section className={styles.install} aria-labelledby="mac-install-title">
          <Laptop size={25} aria-hidden="true" />
          <h2 id="mac-install-title">Install Forma</h2>
          <ol>
            <li>Open the downloaded disk image.</li>
            <li>Drag Forma Companion into Applications.</li>
            <li>Open Forma Companion from Applications.</li>
          </ol>
        </section>
      </div>
    </MacSite>
  );
}
