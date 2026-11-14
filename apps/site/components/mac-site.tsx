import { ArrowDownToLine, ArrowRight, Laptop, Play } from "lucide-react";
import Link from "next/link";
import { CompanionPlayground } from "./companion-playground";
import { HomeExperience } from "./home-experience";
import { DesktopRibbonMark } from "../../desktop/renderer/DesktopRibbonMark";
import styles from "./mac-site.module.css";

function DownloadLink({ href }: { href: string }) {
  return (
    <a className={styles.primary} href={href} referrerPolicy="no-referrer">
      <ArrowDownToLine size={18} aria-hidden="true" /> Download for Mac
    </a>
  );
}

function PreviewLink({ primary = false }: { primary?: boolean }) {
  return (
    <Link
      className={primary ? styles.primary : styles.secondary}
      href="/preview"
    >
      <Play size={16} aria-hidden="true" /> Try the browser demo
    </Link>
  );
}

export function MacHome({ downloadUrl }: { downloadUrl: string | null }) {
  return <HomeExperience downloadUrl={downloadUrl} />;
}

export function MacPreview({
  releaseAvailable,
}: {
  releaseAvailable: boolean;
}) {
  return (
    <div className={styles.previewPage}>
      <section aria-labelledby="mac-preview-title">
        <p className={styles.label}>Explore the companion</p>
        <h1 id="mac-preview-title">
          A little room
          <br />
          <em>to try Forma.</em>
        </h1>
        <p className={styles.intro}>
          A real Problem Desk, a working timer, and guided examples of Tutor,
          reflection, and recall. Pick a feature and make yourself at home.
        </p>
        <Link className={styles.textLink} href="/download">
          {releaseAvailable ? "Get Forma for Mac" : "See Mac release details"}{" "}
          <ArrowRight size={16} aria-hidden="true" />
        </Link>
      </section>
      <div className={styles.playgroundPaper}>
        <CompanionPlayground />
      </div>
    </div>
  );
}

export function MacDownload({ downloadUrl }: { downloadUrl: string | null }) {
  return (
    <div className={styles.split}>
      <section aria-labelledby="mac-download-title">
        <p className={styles.label}>Apple silicon</p>
        <h1 id="mac-download-title">
          Forma <em>for Mac.</em>
        </h1>
        <p className={styles.intro}>
          {downloadUrl
            ? "Your practice workspace and floating Ribbon, together. Connect VS Code, keep a Problem Desk, explore ideas with your optional AI Tutor, and build on what you learn."
            : "Explore Forma’s companion in your browser while the public Mac release is being prepared. The Apple silicon download will appear here when a release is published."}
        </p>
        <div className={styles.actions}>
          {downloadUrl && <DownloadLink href={downloadUrl} />}
          <PreviewLink primary={!downloadUrl} />
        </div>
      </section>
      <section className={styles.install} aria-labelledby="mac-install-title">
        <div className={styles.releaseMark}>
          <DesktopRibbonMark size={52} />
          <span>
            ONE NOTEBOOK.
            <br />A LITTLE PRESENCE BESIDE IT.
          </span>
        </div>
        <p className={styles.releaseState}>
          {downloadUrl
            ? "Public Mac installer available"
            : "Public Mac installer coming later"}
        </p>
        {downloadUrl ? (
          <>
            <Laptop size={25} aria-hidden="true" />
            <h2 id="mac-install-title">Install Forma</h2>
            <ol>
              <li>Open the downloaded disk image.</li>
              <li>Drag Forma Companion into Applications.</li>
              <li>Open Forma Companion from Applications.</li>
            </ol>
          </>
        ) : (
          <>
            <h2 id="mac-install-title">Get a feel for your first session.</h2>
            <p className={styles.releaseNote}>
              The browser sample is ready now. Keep a thought, fold the Ribbon,
              and return to the same problem.
            </p>
            <Link href="/#try-forma" className={styles.textLink}>
              Explore a practice session <ArrowRight size={16} />
            </Link>
          </>
        )}
        <dl className={styles.setupNotes}>
          <div>
            <dt>Your notebook</dt>
            <dd>Local to your Mac, with export and backup options.</dd>
          </div>
          <div>
            <dt>Your editor</dt>
            <dd>
              Pair the VS Code extension when you want to share selected code.
            </dd>
          </div>
          <div>
            <dt>Optional Tutor</dt>
            <dd>
              Use your own supported provider key. Notes and tracking work
              without AI.
            </dd>
          </div>
        </dl>
      </section>
    </div>
  );
}
