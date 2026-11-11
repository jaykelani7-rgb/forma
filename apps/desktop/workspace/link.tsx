import type { ComponentPropsWithRef } from "react";
import { navigate } from "./navigation";

type LinkProps = ComponentPropsWithRef<"a"> & {
  href: string;
  prefetch?: boolean | null;
  replace?: boolean;
  scroll?: boolean;
};

export default function Link({ href, onClick, replace, scroll, target, download, prefetch, ...props }: LinkProps) {
  void prefetch;
  const internal = href.startsWith("/") && !href.startsWith("//");
  return <a {...props} href={internal ? `#${href}` : href} target={target} download={download}
    onClick={event => {
      onClick?.(event);
      if (!internal || event.defaultPrevented || download || event.button !== 0 || event.altKey || event.shiftKey) return;
      event.preventDefault();
      navigate(href, replace, scroll);
    }} />;
}
