# Groundwork repair verification

Verified on Windows x64 on October 4, 2026. The read-only audit was completed and reported before repair authorization; its original findings are preserved in [POST_TRANSFORMATION_AUDIT.md](POST_TRANSFORMATION_AUDIT.md). That report describes the pre-repair state, not current behavior. Existing user edits and deletions were preserved.

## Changes

- Restored the web product's warm paper palette, navy controls, typography, and editorial layout in the desktop, with compiled Tailwind styles and bundled offline fonts.
- Repaired content hashing, ignore/privacy boundaries, watcher reconciliation, stale projects, lexical ranking, snippets, filtering, recent files, project and Git search, and local trained MiniLM retrieval.
- Connected project overview and file history to actual Git data. Preserved findings, files, notes, unfinished work, and Git context in resumable sessions.
- Routed questions and investigations through typed, bounded local tools. Selected files survive search-to-AI and deep investigations. Provider failures remain errors; local mode identifies itself as an excerpt viewer. Citations reflect current reads and actual excerpt bounds.
- Restricted command execution and workspace access. Risky tools use exact-argument, expiring, single-use confirmations. Protected desktop credentials with Windows DPAPI.
- Repaired optional metadata sync acknowledgements, offline queues, tenant isolation, note conflicts, tombstones, account authentication, and payload restrictions. Workspace paths, source files, chunks, and vectors are excluded from sync.
- Bundled Python, Git, and a local embedding model in a Windows NSIS installer. Tauri owns its authenticated loopback backend and manages shutdown/restart. Installed configuration is isolated from development `.env` files.
- Removed fabricated download and performance claims. Updated architecture, AI, retrieval, privacy, packaging, and CI documentation.

## Executed checks

| Check | Result |
| --- | --- |
| Local tests: `python -m pytest server/tests -q` using the packaging environment | 29 passed; one upstream Starlette/AnyIO deprecation warning |
| Cloud tests: `python -m pytest cloud/tests -q` using the cloud-capable environment | 4 passed |
| Ruff: `ruff check server/app cloud/app` | Passed |
| Desktop TypeScript and Vite production build | Passed |
| Website TypeScript and Vite production build | Passed |
| Rust native release compilation | Passed |
| NSIS installer creation | Passed |
| `smoke-core.py`, frozen runtime with empty PATH | Passed: authenticated startup, index/search/read, watcher create/modify/rename/move/delete, real bundled Git/history/diff, current-source AI citations, missing provider key, exact-action confirmation, graceful shutdown/restart, persistence |
| `smoke-scale.py`, frozen runtime with empty PATH | Passed: 1,101 real files, interrupted indexing and restart reconciliation, old-file lexical and trained semantic search, ignored folders/secrets, 30 rapid edits, changed ignore rules, explicit reindex |
| `smoke-sync.py`, real HTTP cloud plus frozen core | Passed: register/login, metadata push/pull, device registration, tenant isolation, path rejection, cloud outage, retained queue/retry, logout and local offline search |
| `smoke-installed.cjs`, silently installed desktop and real WebView2 | Passed: install, native launch/backend startup, workspace setup/index, Git overview, keyboard search/inspector, grounded AI, investigation/save/resume, note create/edit, service restart, normal close/backend shutdown, relaunch and persistence |
| `git diff --check` | Passed |

The installed-app test isolates application state, removes developer executables from PATH, blocks remote HTTPS requests, and exercises actual UI controls. It tests native service restart and verifies that normal application close stops its backend, followed by relaunch and persistence. Screenshots are written to `desktop/test-results/`.

The final installed screenshots were visually inspected: Quick Find shows actual paths, source lines, snippets, relevance details, and the split inspector; the relaunched notes view retains the edited note and its project association. The desktop preserves the paper palette, navy controls, hairline borders, and editorial typography.

The installer tests exposed and repaired development CORS configuration leaking into installed startup and new notes disappearing from the selected project's filtered view because the project association was missing. Hosted Windows testing additionally exposed short-path aliases being compared with canonical workspace paths. Indexing now normalizes those paths, with both a regression test and an actual Windows 8.3 alias check passing. The hosted installed-app test scopes a temporary WebView2 machine-policy override to its executable, restoring the previous value afterward; this handles current elevated-runner debugging restrictions without changing application defaults.

## Retrieval measurements and limits

The current fifteen-query source-code evaluation measured lexical Recall@1 100%, semantic Recall@1 80%, and hybrid Recall@1 100%. Mean query times on this run were 4.25 ms, 62.07 ms, and 61.94 ms respectively. These figures are specific to this small curated corpus and this machine, not production guarantees. The separate larger-directory check verifies correctness and recovery, not universal scale or latency. Exact vector scanning grows with the number of chunks. See `server/eval/benchmark_report.md` for the current report.

## Release scope

Groundwork remains in development. Windows installer and download checks validate specific behavior; they do not mean that the product is finished or ready for a 1.0 release. Public 0.x builds are previews.

[Main CI](https://github.com/ttnhan227/Groundwork/actions/runs/37168836149) passed all five jobs, including native Windows installer creation and actual installed WebView2 lifecycle checks. MSI creation passed in that build, but MSI installation was not tested. The installer remains unsigned. macOS, Linux, and SmartScreen behavior are unverified. Native compilation includes the global shortcut and folder chooser; off-focus OS shortcut registration and interactive folder-dialog selection are not covered by the automated WebView2 workflow.

Real paid-provider generation and Ollama model inference are unverified without configured credentials/models. Their missing-key/failure paths and bounded provider context are tested. Local excerpt mode and bundled semantic retrieval work without accounts or network access. Cloud operation was verified against an isolated local HTTP service, not a deployed public endpoint.

Automatic approval review blocked optional deletion of unused generated icon directories. Those assets remain; this has no effect on packaged behavior.
