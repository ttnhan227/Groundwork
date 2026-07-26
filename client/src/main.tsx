import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import Providers from "./Providers";
import "./index.css";

// Render may suspend the free API while it is idle. Wake it as soon as the
// static client loads so the cold start happens while the visitor reads the
// login screen rather than after they submit the form.
const apiBase = import.meta.env.VITE_API_URL ?? "/api/v1";
const healthUrl = `${apiBase.replace(/\/api\/v1\/?$/, "")}/health`;
void fetch(healthUrl, {
  cache: "no-store",
  credentials: "omit",
  headers: { Accept: "application/json" },
}).catch(() => {
  // Warm-up is best-effort. Normal API requests still surface real errors.
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Providers>
      <App />
    </Providers>
  </StrictMode>,
);
