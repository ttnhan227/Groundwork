import { useState } from "react";
import { Menu, X } from "lucide-react";
import { BrandMark } from "../common/BrandMark";
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
        <button
          onClick={() => navigate("/")}
          className="product-wordmark"
          aria-label="Groundwork home"
        >
          <BrandMark size={28} />
          <span>Groundwork</span>
        </button>
        <button
          className="product-mobile-menu"
          aria-label={expanded ? "Close menu" : "Open menu"}
          aria-expanded={expanded}
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? <X size={22} /> : <Menu size={22} />}
        </button>
        <nav
          aria-label="Main navigation"
          className={`product-nav-links ${expanded ? "is-open" : ""}`}
        >
          {links.map((link) => (
            <button
              key={link.path}
              aria-current={currentRoute === link.path ? "page" : undefined}
              onClick={() => {
                navigate(link.path);
                setExpanded(false);
              }}
            >
              {link.label}
            </button>
          ))}
        </nav>
      </div>
    </header>
  );
}
