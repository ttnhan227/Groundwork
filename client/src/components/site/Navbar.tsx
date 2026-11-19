import { useState } from "react";
import { Menu, X } from "lucide-react";
import { BrandMark } from "../common/BrandMark";
import { AppLink } from "../common/AppLink";

export function Navbar({
  currentRoute,
  navigate,
}: {
  currentRoute: string;
  navigate: (path: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const links = [
    { path: "/", label: "Home" },
    { path: "/download", label: "Downloads" },
    { path: "/about", label: "About" },
    { path: "/contact", label: "Support" },
    { path: "/resources", label: "Resources" },
    { path: "/contributors", label: "Contributors" },
  ];
  return (
    <header className="product-navbar">
      <div className="product-nav-inner">
        <AppLink
          to="/"
          navigate={navigate}
          onClick={() => setExpanded(false)}
          className="product-wordmark"
          aria-label="Groundwork home"
        >
          <BrandMark size={28} />
          <span>Groundwork</span>
        </AppLink>
        <button
          type="button"
          className="product-mobile-menu"
          aria-label={expanded ? "Close menu" : "Open menu"}
          aria-expanded={expanded}
          aria-controls="primary-navigation-list"
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? <X size={22} /> : <Menu size={22} />}
        </button>
        <nav
          aria-label="Main"
          className={`product-nav-links ${expanded ? "is-open" : ""}`}
        >
          <ul id="primary-navigation-list" className="product-nav-list">
            {links.map((link) => (
              <li key={link.path}>
                <AppLink
                  to={link.path}
                  navigate={navigate}
                  aria-current={currentRoute === link.path ? "page" : undefined}
                  onClick={() => setExpanded(false)}
                >
                  {link.label}
                </AppLink>
              </li>
            ))}
          </ul>
        </nav>
      </div>
    </header>
  );
}
