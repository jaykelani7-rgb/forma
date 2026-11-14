import type { Metadata } from "next";
import localFont from "next/font/local";
import Link from "next/link";
import type { ReactNode } from "react";
import { RibbonMark } from "../../../packages/ribbon/RibbonMark";
import { SiteNavigation } from "../components/site-navigation";
import styles from "../components/mac-site.module.css";
import { webNotebookOrigin } from "../lib/site-links";
import "./globals.css";

const geist = localFont({
  src: [
    { path: "../../../public/fonts/geist-regular.ttf", weight: "400" },
    { path: "../../../public/fonts/geist-medium.ttf", weight: "500" },
    { path: "../../../public/fonts/geist-semibold.ttf", weight: "600" },
  ],
  variable: "--geist",
});

const instrument = localFont({
  src: [
    { path: "../../../public/fonts/instrument-regular.ttf", weight: "400", style: "normal" },
    { path: "../../../public/fonts/instrument-italic.ttf", weight: "400", style: "italic" },
  ],
  adjustFontFallback: "Times New Roman",
  variable: "--instrument-serif",
});

const mono = localFont({
  src: [{ path: "../../../public/fonts/geist-mono-regular.ttf", weight: "400" }],
  variable: "--font-mono",
});

export const metadata: Metadata = {
  title: "Forma for Mac",
  description: "Forma is a Mac companion for competitive programming: connect your VS Code practice, think through ideas with an optional AI Tutor, and remember what you learn.",
  icons: { icon: `${process.env.FORMA_SITE_BASE_PATH ?? ""}/favicon.svg` },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  const notebook = webNotebookOrigin();

  return (
    <html lang="en" className={`${geist.variable} ${instrument.variable} ${mono.variable}`}>
      <body className={styles.site}>
        <a className="skip-link" href="#main-content">Skip to content</a>
        <header className={styles.header}>
          <Link className={styles.brand} href="/" aria-label="Forma home">
            <RibbonMark size={36} />
            <span>forma</span>
          </Link>
          <SiteNavigation />
        </header>
        <main id="main-content" className={styles.main} tabIndex={-1}>{children}</main>
        <footer className={styles.footer}>
          <span>Forma</span>
          {notebook && (
            <nav aria-label="Web notebook">
              <a href={`${notebook}/today`}>Open web notebook</a>
              <a href={`${notebook}/settings`}>Export web data</a>
            </nav>
          )}
        </footer>
      </body>
    </html>
  );
}
