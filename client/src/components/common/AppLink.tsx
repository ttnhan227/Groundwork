import type { AnchorHTMLAttributes, MouseEvent } from "react";

export interface AppLinkProps extends AnchorHTMLAttributes<HTMLAnchorElement> {
  to: string;
  navigate: (path: string) => void;
}

/**
 * Renders a native `<a href>` link that intercepts unmodified primary clicks
 * for client-side SPA routing while preserving Ctrl/Cmd-click, middle-click,
 * and context-menu browser behaviors.
 */
export function AppLink({
  to,
  navigate,
  onClick,
  target,
  ...rest
}: AppLinkProps) {
  const handleClick = (event: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(event);
    if (
      event.defaultPrevented ||
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey ||
      (target && target !== "_self")
    ) {
      return;
    }
    event.preventDefault();
    navigate(to);
  };

  return <a href={to} target={target} onClick={handleClick} {...rest} />;
}
