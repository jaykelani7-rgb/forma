import { ArrowDownToLine, ArrowRight, Play } from "lucide-react";
import Link from "next/link";
import { CompanionPlayground } from "./companion-playground";
import { HomeExperience } from "./home-experience";
import { WindowsWaitlist } from "./windows-waitlist";
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

export function MacDownload({
  downloadUrl,
  waitlistUrl,
}: {
  downloadUrl: string | null;
  waitlistUrl: string | null;
}) {
  return (
    <div className={styles.split}>
      <section aria-labelledby="mac-download-title">
        <h1 id="mac-download-title">
          Forma for Mac <em>is ready.</em>
        </h1>
        <p className={styles.intro}>
          A practice workspace and a floating companion that keeps your next
          thought beside your code.
        </p>
        <div className={styles.actions}>
          {downloadUrl && <DownloadLink href={downloadUrl} />}
          <PreviewLink primary={!downloadUrl} />
        </div>
        {downloadUrl && (
          <details className={styles.installHelp}>
            <summary>How to install on an Apple silicon Mac</summary>
            <ol>
              <li>Open the downloaded disk image.</li>
              <li>Drag Forma Companion into Applications.</li>
              <li>Open Forma Companion from Applications.</li>
            </ol>
          </details>
        )}
      </section>
      <section
        className={styles.waitlist}
        id="windows-waitlist"
        aria-labelledby="windows-title"
      >
        <h2 id="windows-title">
          Forma for Windows <em>is in development.</em>
        </h2>
        <p>Get an email when Forma is ready for Windows.</p>
        <WindowsWaitlist endpoint={waitlistUrl} />
      </section>
    </div>
  );
}
