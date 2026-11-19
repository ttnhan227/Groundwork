import { AppLink } from "../common/AppLink";

export function Footer({ navigate }: { navigate: (path: string) => void }) {
  return (
    <footer className="product-footer">
      <span>
        Groundwork is open-source software under the{" "}
        <a href="https://github.com/ttnhan227/Groundwork/blob/main/LICENSE">
          MIT license
        </a>
        .
      </span>
      <nav aria-label="Footer" className="product-footer-nav">
        <ul>
          <li>
            <span aria-hidden="true"> · </span>
            <AppLink to="/privacy" navigate={navigate}>
              Privacy
            </AppLink>
          </li>
          <li>
            <span aria-hidden="true"> · </span>
            <AppLink to="/contact" navigate={navigate}>
              Contact
            </AppLink>
          </li>
        </ul>
      </nav>
    </footer>
  );
}
