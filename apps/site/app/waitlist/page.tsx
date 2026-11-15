import type { Metadata } from "next";
import Link from "next/link";
import { windowsWaitlistUrl } from "../../lib/site-links";
import { WindowsWaitlist } from "./windows-waitlist";
import styles from "./waitlist.module.css";

export const metadata: Metadata = {
  title: "Join the Forma waitlist",
  description: "Get an email when Forma launches on Windows.",
};

export default function WaitlistPage() {
  return (
    <div className={styles.page} data-waitlist-page>
      <section className={styles.invitation} aria-labelledby="waitlist-title">
        <h1 id="waitlist-title">
          Join the <em>waitlist.</em>
        </h1>
        <p>Get an email when Forma launches on Windows.</p>
        <WindowsWaitlist endpoint={windowsWaitlistUrl()} />
      </section>
      <footer className={styles.availability}>
        <p>
          <Link href="/download">Forma for Mac is ready.</Link> Forma for
          Windows is in development.
        </p>
      </footer>
    </div>
  );
}
