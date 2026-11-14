"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect } from "react";
import styles from "./mac-site.module.css";

const links = [
  { href: "/#try-forma", label: "Explore" },
  { href: "/preview", label: "Preview" },
  { href: "/download", label: "Download" },
];

export function SiteNavigation() {
  const pathname = usePathname()?.replace(/\/$/, "");
  useEffect(() => {
    let frame = 0;
    const update = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        document.documentElement.dataset.siteScrolled = String(scrollY > 80);
        const range = document.documentElement.scrollHeight - innerHeight;
        document.documentElement.style.setProperty(
          "--reading-progress",
          `${range > 0 ? scrollY / range : 0}`,
        );
        frame = 0;
      });
    };
    update();
    window.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
      delete document.documentElement.dataset.siteScrolled;
      document.documentElement.style.removeProperty("--reading-progress");
    };
  }, [pathname]);
  return (
    <nav className={styles.navigation} aria-label="Forma">
      {links.map(({ href, label }) => (
        <Link
          key={href}
          href={href}
          aria-current={pathname === href ? "page" : undefined}
        >
          {label}
        </Link>
      ))}
    </nav>
  );
}
