# Groundwork — Phase 0/1 audit

Audit date: October 1, 2026, Asia/Saigon. Repository: `C:\Users\ttnha\Documents\projects\Groundwork`. HEAD: `411fae8`; findings apply to the actual working tree, including its pre-existing modifications and deletions.

No repository source or configuration was edited, no dependencies were installed, and nothing was deleted. Builds, databases, filesystem/Git fixtures, and screenshots used temporary paths outside the repository. The benchmark was called through its functions because its normal command overwrites the repository's benchmark report. Temporary HTTP preview servers were stopped. This report is also outside the repository.

Evidence labels: **Observed** means executed in this environment; **Code** means established by reading implementation; **Unverified** means no successful runtime verification. P0 means a security/privacy blocker; P1 means a release/core-workflow blocker; P2 means a material correctness or usability defect; P3 means polish. These are audit priorities, not claimed exploitability scores.

## 1. Executive summary

Groundwork has a real local SQLite/FTS5 foundation, actual filesystem indexing, actual Git CLI reads, persistent notes and sessions, and a real optional cloud API. It is not a trustworthy finished desktop product.

The immediate problems are:

1. **P0: local API authorization is absent.** Arbitrary web origins are allowed; filesystem registration, reads and command-token requests are unauthenticated.
2. **P0: command confirmation is bypassable.** Tokens neither expire nor bind the approved command/cwd; prefix allowlisting combined with `shell=True` permits chained commands. A harmless chained echo reproduced this.
3. **P0: privacy claims contradict outbound code paths.** Remote generation receives source snippets/paths, and selecting a remote embedding provider can upload indexed chunks. Sync's actual queue includes note bodies and attachment paths despite a metadata-only inspection helper/test.
4. **P1: desktop styles are not compiled.** Tailwind is imported but its compiler is not configured. The rendered sidebar is 1180px wide in an 1180px window; the root is block flow and its main heading is 14px. A passing Vite build obscures the defect.
5. **P1: automatic backend startup and production packaging are missing.** The Rust launcher function is never called at startup or by React; there is no bundled backend/runtime, and the Tauri CLI dependency is absent.
6. **P1: index/watch correctness is incomplete.** Ignored/build files enter through watcher events, newly registered roots are not watched, and emptied files remain searchable.
7. **P1: sync can lose data.** Partial note updates erase remote fields; HTTP 200 clears queued items even when zero items were processed. There is no local pull/apply path.

Reconstruction should preserve the visual identity and useful data foundation, but replace insecure execution, startup/packaging, incomplete retrieval and sync contracts. Phase 2 has not begun.

## 2. Repository structure

| Area | Actual role and state |
| --- | --- |
| `desktop/` | React 19/TypeScript/Vite UI plus a small Tauri 2 Rust shell. Views for projects, search modal, activity, sessions, AI, notes and settings. npm lockfile and installed dependencies present; `dist/` already existed. |
| `server/` | Local FastAPI application; SQLite WAL/FTS5; file parser, indexer, watcher, project/Git services, notes/sessions, retrieval, provider adapters, sync queue. Eight test modules and one search evaluation harness. |
| `cloud/` | Separate FastAPI account/device/sync service using synchronous SQLAlchemy. PostgreSQL dependency exists, but current default is SQLite. One integration test using SQLite. No schema migration system. |
| `client/` | Currently a static marketing/download/docs/privacy/changelog website, not the old browser workspace. npm dependencies, old screenshots/assets and old test-result artifacts remain. |
| `docs/` | Four architecture/search/privacy/AI documents, containing significant aspirational or incorrect claims. |
| Root | Two Ruff/pytest configurations, Compose, Render static hosting config, ignored `.env`, example environment, README, `.github` CI/deploy workflows. No root Node workspace/package manifest or shared UI package. |
| `tmp/` | Existing PDF preview image; unrelated generated artifact, not product implementation. |

Environment actually available: Python 3.12.10, Node 26.5.0, npm 11.17.0, Ruff and Docker Engine 29.8.0. Rust/Cargo are unavailable. Existing `server/.venv` points to this Python installation and records its creation under an older `InsightPDF` path. No separate cloud virtual environment was found. Global Python includes FastAPI 0.116.1, Pydantic 2.13.4, NumPy 2.5.1, watchfiles 1.2.0, pytest 8.4.1, SQLAlchemy 2.0.41 and httpx 0.28.1. Global and existing venv `pip check` pass; that does not establish a clean requirements-only installation.

Package management: separate npm manifests/locks, pip requirements without a full transitive lock, Cargo manifest without a Cargo lockfile. Client requires Node >=22.13.0, contrary to root README's Node 20+. Desktop has a `tauri` script but no `@tauri-apps/cli` dependency. Its installed Tailwind Vite plugin is not activated. PyMuPDF is importable on this machine but undeclared in server requirements. Optional sentence-transformers requirements are present, but that library is unavailable here and unused by the embedding implementation.

The working tree already contained substantial UI/security/index/search edits, an untracked desktop UI directory and cloud conftest, and deletions of old migrations/evaluation/E2E files. Those were preserved. Existing caches, node_modules, dist and old test results are not evidence of a current successful release.

## 3. What actually works

**Observed:** 18 local tests pass from `server/`; the cloud's one SQLite test passes. Python syntax parses for all 43 application files. Both frontends type-check and bundle.

**Observed:** an isolated database indexed 126 supported files from the actual Groundwork repository with no reported errors, in about 1.69 seconds. Searches returned real `main.rs`, `git_service.py`, `DownloadPage.tsx` and other source files. No production hardcoded file-search dataset was found.

**Observed:** a real temporary Git repository produced real commits/branch/untracked status. Live watchfiles events updated SQLite for create, modify, rename, move and delete. Watcher restart and a 50-file burst worked; no duplicate file paths were recorded in that fixture.

**Observed:** persistent SQLite notes/session create-update functionality and FTS5/WAL behavior pass existing tests. Cloud registration, devices, push/pull and tenant isolation pass the single cloud test; unauthenticated cloud pull returns 401.

**Code:** core indexing/search/project functionality does not call cloud authentication or sync. Default local embeddings and extractive response generation operate without a cloud account. This is a usable foundation, not evidence of a complete offline installer.

## 4. What is broken

| Finding | Evidence/type | Severity |
| --- | --- | --- |
| Desktop utility styles missing | Fresh build warnings retain `@theme`/`@tailwind`; actual Chromium layout is unstyled | P1 |
| Backend not automatically launched | Registered Rust command has no setup invocation; React never invokes it | P1 |
| Native dev/build command unavailable | `npm run tauri -- --version` fails: tauri not recognized | P1 |
| New workspace roots not watched | Second root added after watcher startup stayed unindexed for the bounded 3s probe; loop captures roots until watch terminates | P1 |
| Ignore rules inconsistent | Live changes under `ignored/`, `dist/`, and ignored `customskip.txt` were indexed | P1 |
| Empty file stays searchable | After emptying/reindexing `source.txt`, its old `alphaunique` content remained | P1 |
| Metadata hash misses content changes | Equal-size edit with restored mtime still returned `beforemarker` | P2 |
| Newly ignored file stays indexed | Adding an ignore rule and reindexing retained an existing file record | P2 |
| Nested project assigned to parent | `child/inside.py` was attributed to outer audit project; first ancestor wins | P2 |
| Relative paths wrong | Stored path is drive-root-relative `Users\...\workspace\...`, not workspace-relative | P2 |
| Search line references inaccurate | Match placed on line 74 reported line 41, the chunk start | P1 |
| Citation end invented | Two-line README cited as lines 1–21 | P1 |
| Search-to-AI loses context | App discards query and chosen file; only optional project id survives | P1 |
| AI action buttons incomplete | Save as Note and View Associated Commits lack handlers; investigation session can be duplicated | P2 |
| Command dialog contract mismatch | UI expects `status=confirmation_required`; backend returns boolean `requires_confirmation` | P1 |
| Sync endpoint mismatch | Default local URL adds `/api/v1`; cloud `/api/v1/sync/pull` returns 404 | P1 |
| Sync content loss / false acknowledgement | Reproduced partial update field erasure and clearing queue on zero-item acknowledgement | P1 |
| Lint failures | Client: one error/13 warnings; Ruff: 20 errors | P2 |

No Python syntax or TypeScript compile error was found in the installed environment. Most important failures are behavior, security, integration, missing implementation, and misleading success states.

## 5. What is placeholder/fake

- **Download buttons:** `client/src/pages/DownloadPage.tsx` prevents navigation and shows “Starting download”; no package is downloaded. Sizes, abbreviated checksums and advertised installer/portable filenames are static data with no attached release build.
- **Marketing examples:** landing search results, activity, session checklist and AI answer are static illustrations, not live product data. Its example cites nonexistent `sanitize_path()`/`SecurityError`. These should be visibly examples, not verification evidence.
- **Default AI:** `OfflineProvider` extracts prompt lines and formats them. It does not reason about a question, plan tools or verify hypotheses. The investigation prompt lacks the code-fence format its extractor expects, so the observed “analysis” repeats headings/question rather than the relevant code.
- **Empty-evidence answer:** prints “verified evidence” followed by “No matching files found” and the prompt's answer instruction. This is a misleading verified-success presentation.
- **Investigation citations:** frontend invents the snippet “Identified as critical component during investigation” with no lines, instead of receiving evidence-backed citation records.
- **Commit changed files:** every fetched commit sets `changed_files=[]`; not actual diff extraction.
- **Status:** frontend initially assumes core online, footer says Ready without successful load, and the backend status always says ready. TCP startup accepts any listener as core and returns a successful string after timeout.
- **Capabilities advertised but absent:** native global shortcut, file-history UI/API, AST context expansion, multi-step AI tool planning, settings/provider persistence and functional multi-device desktop sync.

No hardcoded desktop project list, fake filesystem metadata source, or simulated indexer was found. Real data paths exist but are incomplete.

## 6. What is duplicated

- Client and desktop copy essentially the same token palette, typography, radii, shadows and BrandMark independently. Their global styles already diverge.
- Desktop UI primitives closely recreate historical web Button/Card/Badge/Input/Modal/EmptyState/citation components; they are not shared.
- Python root/server Ruff/pytest configs overlap with different test behavior. Running tests from root selected server configuration and failed app imports; running from server succeeded.
- Client still wraps a static site in React Query and warms an old API health endpoint.
- ProjectService and GitService each implement subprocess wrappers; the indexer and watcher separately implement incompatible ignore logic.
- Local DTOs include unused alternative request/update/status models; server session updates bypass the declared update model with unrestricted dictionaries.

## 7. What is obsolete — classification

Classification concerns proposed reconstruction, not permission to delete now.

| Significant code/files | Class | Decision |
| --- | --- | --- |
| SQLite manager, WAL/FTS5 schema foundation | KEEP | Real persisted local data; add versioned migrations and lifecycle/concurrency tests |
| Local domain types / API types | ADAPT | Tighten validation and reconcile transport contracts |
| Workspace/notes/session/saved-search services | ADAPT | Keep persistence, fix ownership, update validation, activity and sync semantics |
| Python AST parser and text chunking | ADAPT | Useful; exact offsets, bounded reads and error reporting need work |
| Non-Python regex symbol extraction | ADAPT | Label limitations accurately; replace with parsers where necessary |
| Project/Git services | ADAPT | Correct nested roots, freshness, history/diffs/date formats and ignored project discovery |
| Indexer/watcher | ADAPT | Keep real scanning/events; reconstruct common eligibility and robust job lifecycle |
| Search candidate/ranking implementation | REWRITE | Keep FTS5 but fix BM25 normalization, independent semantic retrieval, scale and line accuracy |
| Embedding adapters | REWRITE | Separate generation/embedding settings, local-only indexing policy, model/version persistence |
| AI provider HTTP adapters | ADAPT | Explicit errors, consent and actual provider reporting |
| Offline synthesis / investigation orchestration | REWRITE | Honest extractive mode plus genuine bounded evidence/tool workflow |
| Command authorization/execution | REWRITE | Expiring action-bound confirmations and argv execution, no shell prefix policy |
| Local sync service / cloud sync contract | REWRITE | Item acknowledgements, stable updates, pull/apply, tombstones and conflict strategy |
| Cloud account/device models/routes | ADAPT | Appropriate role; strong password handling, validation, migrations and session controls |
| Tauri launcher/process lifecycle | REWRITE | Managed packaged sidecar, verified readiness, port/auth discovery and supervised shutdown |
| Desktop navigation/workflow views | REWRITE/ADAPT | Reconstruct primary search/inspect flow; preserve useful primitives |
| Web tokens, logo assets, historical UI primitives | KEEP | Preserve visual language and adapt interaction/layout patterns |
| Marketing pages | ADAPT | Retain design; remove unverified release/privacy/feature claims |
| Existing local/cloud tests | ADAPT | Useful small tests; add missing adversarial/workflow cases |
| Evaluation harness | ADAPT | Keep reproducibility; expand corpus/metrics and remove hardcoded conclusions |
| Old deploy workflow and worker image | DELETE/REPLACE | Deploys local core and removed Celery worker architecture |
| Legacy client API warm-up, auth build args/proxies | DELETE | No matching static-site workflow remains |
| Old client document-related dependencies | DELETE after usage verification | pdfjs, form/resolver/zod leftovers have no current product usage; React Query wrapper is unnecessary here |
| Optional sentence-transformers requirements | DELETE or intentionally implement | Present dependency file is disconnected from runtime |
| Existing dist/caches/test-results | UNKNOWN / generated | Preserve during audit; do not treat as current releases |
| Historical screenshots/alternate logo images and `tmp/` preview | UNKNOWN | Retain reference assets until their intended role is decided |
| Pre-existing deleted Alembic/E2E/evaluation files | Obsolete architecture / reference only | Do not restore old runtime; preserve useful history/test ideas |

## 8. Old Groundwork/RAG remnants

Current server application does not contain the old upload API, document database models, pgvector/PostgreSQL local index, Redis client, Celery tasks or old retrieval/citation pipeline. SQLite is genuinely the local store. PostgreSQL in `cloud/` is justified for optional multi-tenant state; PostgreSQL is not needed locally.

Remnants remain in `.github/workflows/deploy.yml`: worker image, `celery -A app.tasks.celery_app:celery_app`, Redis, MinIO originals bucket, old LLM/embedding secrets and deployment of `server/` to Cloud Run. The worker code and dependency no longer exist. This workflow is actively configured on pushes to main; remote deployed state was not inspected.

Ignored root `.env` still has old DATABASE_URL, MinIO settings, LLM gateway variables, embedding model, Google client IDs and admin credentials. Values were not printed. Most are ignored by current local settings, making configuration misleading. `.env.example` mixes cloud DATABASE_URL with an asyncpg dialect although cloud uses synchronous SQLAlchemy/psycopg2; it also contains a development JWT default. No live key validity or full historical secret scan was performed.

Client retains old auth API warm-up, Vite `/api` and `/ws` proxies, Google build argument, form/PDF dependencies, legacy account/jobs/PDF CSS and an old workspace screenshot. Root `.gitignore` still names Redis/MinIO/Postgres data folders and an old SaaS specification artifact. These do not justify reintroducing old services.

## 9. Desktop architecture problems

Actual architecture is a React UI assuming a manually available fixed-port HTTP service, plus a thin Rust shell with unused launcher commands. There is no unified startup state machine, backend discovery handshake, authenticated local session or release pipeline.

Tauri config has no `externalBin`/resource backend bundle; no backend freezing/build script, packaged Python, packaged Git, installer artifact or Windows installer test was found. Git integration also depends on `git` on PATH. CSP is null. The desktop's favicon points at an asset not present in its public directory. Google-hosted fonts introduce external requests and offline fallback-font variation.

No native global-shortcut plugin/registration exists. Ctrl+Space/Ctrl+K are DOM key listeners effective when the application receives keyboard input.

## 10. Desktop ↔ FastAPI integration status

Source: `desktop/src-tauri/src/main.rs` and `desktop/src/services/api.ts`.

- **Startup:** `start_local_core` searches relative source paths and runs `python -m uvicorn ... --host 127.0.0.1 --port 8000`, otherwise runs `groundwork-core` through PATH. No startup hook invokes it; React does not invoke it either.
- **Discovery:** hardcoded `http://127.0.0.1:8000`. Rust probes only a TCP connection, not `/health`, service identity, version or a per-launch secret.
- **Port handling:** no allocation/lock/ownership protocol. Any existing listener is accepted. Concurrent spawn checks are not a verified singleton design.
- **Failure:** after three seconds, returns an Ok message even if readiness fails. A stored exited child is not cleared/restarted through process supervision.
- **Shutdown:** Exit callback kills/waits an owned child, if one exists. It is forced termination; runtime/native behavior is unverified. A manually started server is not owned or stopped.
- **Binding:** developer launcher/main use loopback. `server/start.sh` uses `0.0.0.0`; Compose publishes `8000:8000` without a loopback host restriction. Thus the local-only guarantee does not hold for all supplied launch paths.
- **Cloud:** no core startup dependency on cloud, but native offline launch cannot be verified without the missing native toolchain and packaged backend.

The intended installer → launch → ready experience is **not implemented or verified**. No Python/Node-free production claim is justified.

## 11. Search/indexing status

FTS5 and persisted chunks are real. Filename/path LIKE matching, chunk lexical matches, vector cosine ranking and recency weights operate on real SQLite records. Workspace/project filters exist; file type/date filters, unified note/project/commit result types and recent searches are absent from the primary search UI.

Important defects:

- Local vectors are token/character n-gram hashes, not a trained semantic language model. Calling them semantic understanding overstates behavior.
- Hybrid vector search restricts itself to lexical/filename candidates when those exist; it cannot independently recover a semantically relevant file outside that set.
- Pure vector search inspects only the newest `max(1000, limit*20)` chunks. In a real generated 1,051-file fixture, the exact older file was absent from semantic results and present in lexical results. This fixture diagnoses truncation, not production relevance quality.
- Vectors are JSON stored in SQLite and scanned in Python; no separate ANN/vector index or model/dimension version registry exists. Mixed remote/local fallback dimensions silently lose candidates.
- BM25 mapping decreases score as the magnitude of SQLite's negative relevance rank increases, reversing relevance within the selected candidates.
- FTS query words are ASCII regex tokens combined with AND. Non-ASCII queries, punctuation and natural-language recall require better handling.
- `fts_files` stores symbols but the active lexical path queries only chunks; its promised fallback is just a log message.
- Per-stage limits truncate candidates; `total_matches` counts merged candidates rather than all matching files. Filename candidates are limited before relevance sorting.
- Recency implementation and actual weights differ from docs: actual hybrid is .35 lexical/.30 vector/.20 filename/.10 project/.05 recency, with `exp(-.1*age_days)`.
- Lines identify chunk starts, not exact matches. Dedupe is by file id, which intentionally suppresses multiple useful hits within a file; stale/deleted records need consistent cleanup.
- Hash is SHA-256 of mtime/size/name, not file bytes. Empty/binary/oversized conversion leaves previous records untouched. New ignore rules do not evict still-existing files.
- Default pattern substring matching is overbroad (e.g. names containing `env`, `bin` or `obj`). `.gitignore` supports only rudimentary root fnmatch rules, without proper nested rules/negation semantics.

Watcher observations: create/modify/rename/move/delete passed in an existing root; `.git`/node_modules are specially excluded in code, node_modules changes stayed excluded in the fixture. dist/custom/root-gitignore exclusions failed. New roots failed. Restart and 50-file burst passed. Watcher events do not set project_id on activities; .git exclusion means new commits/branches are not refreshed by those events. No automatic startup catch-up scan exists. Hard-kill recovery, long-running race/load behavior, directory deletion variations and production-scale performance remain unverified.

## 12. Git integration status

Real repository detection, recent commit retrieval, branch lookup and working-tree subprocess status exist. Existing tests and a fresh temporary repository verified basic behavior. Commit-message search uses SQLite LIKE over at most the recently synced commits.

Missing/incomplete: per-commit changed files are always empty; no file-history implementation, no automatic commit refresh, no branch list UI and no current-working-tree API/view. Detection checks only path/parent `.git`, not arbitrary ancestor discovery. Detached HEAD/error can be mislabeled `main`. Porcelain output parsing strips leading whitespace and uses non-NUL paths, making modified paths, spaces, quotes and renames unreliable.

The no-query commits endpoint returns `commit_hash`/raw JSON fields, while search returns `hash`/`short_hash`/parsed changed files; frontend declares the latter for both. This mismatch was observed through the API. Git dates use `YYYY-MM-DD HH:MM:SS +offset` while activity cutoffs use ISO `T` strings, so SQL text comparisons can omit same-day commits. GitService's recent-commits tool ignores its advertised project_id.

## 13. AI context engine status

Actual query flow is search → up to six snippets → provider call → citation list. Investigation adds one commit-message search and creates a persisted session. It is not a tool-planning or iterative agent loop. Typed tool names exist, but schemas are loose dictionaries, and generation does not call those tools. Request `files` is unused in investigation; selected source context is not honored through the UI handoff.

Citation ranges are generated from chunk starts plus an arbitrary 20 lines; source ranges and answer citations are not validated. The two-line README/line-74 probes fail exactness. Grounding is a prompt instruction, not output verification. Context limits are snippet counts/character slicing rather than a measured token budget; file tools read whole files before slicing, without a size cap or sensitive-file policy.

Remote adapters and Ollama support are implemented HTTP paths, but no live external/local model request was made. A transport spy confirmed OpenAI generation receives local source text and paths. Remote indexing adapters send chunks for embedding too. AI provider selection also controls embedding generation, coupling search privacy and index compatibility to chat choice.

Missing keys silently select offline generation. Provider HTTP failures silently fall back to offline text while `provider_used` remains e.g. `openai`; reproduced with a simulated failure. Unknown providers also silently become offline. Errors/readiness/consent need first-class results. File content/prompt injection has no structured trust treatment beyond system prompt instructions.

Session persistence stores only truncated investigation summary/notes, plus generic todos. Full analysis, user question history, evidence ranges, decisions and follow-up state are not captured sufficiently for continuation.

## 14. Cloud/sync status

Cloud has a sensible narrow role: users, devices, notes, searches and settings. There are no cloud file/chunk/vector-index models. It should remain optional.

However:

- Local default endpoint is versioned but actual cloud routes are not; reproduced 404.
- Local sync implements push only. Cloud pull exists, but desktop/local backend never applies it. No desktop login/device pairing/token lifecycle/settings-edit flow exists.
- Notes queue full NoteCreate data, including content, project id and attachment path. Metadata-only `get_sync_payload()` is not what trigger_sync transmits. Notes are allowed by the intended cloud role, but consent/scope and actual transport must match the UI description.
- Note update queues partial dictionaries; cloud supplies defaults for missing fields. A title-only update erased body and tags in the cloud fixture.
- Client deletes all sent queue entries on HTTP 200 without acknowledgements. A response with processed_count=0 still returned success/synced_count=1 and emptied the queue.
- Unknown entity types are ignored with HTTP 200 success. Unknown actions become upserts. Setting delete is treated as an update to `{}`; reproduced.
- No device-aware revisions, conflict handling, tombstone pull, stable replay/idempotency protocol, pagination or automatic backoff flush. Notes remain `pending` even after reported sync success.
- Disabled/unconfigured sync returns skipped; connection failures preserve the queue. Core services remain independent in code. Actual multi-device, PostgreSQL, network-disconnected native app and deployed Cloud Run behavior are unverified.

## 15. Security issues

**P0 — unauthenticated local control surface.** The API allows arbitrary workspace registration, so existing workspace-boundary checks do not protect against a caller choosing new roots. Observed untrusted Origin preflight was accepted with its origin reflected; unauthenticated workspace listing returned 200. No local request secret, origin/host validation or process identity handshake exists. Browser private-network protections vary and are not an authorization design.

**P0 — unsafe shell authorization.** `is_safe_command` accepts all `git `, arbitrary npm scripts, test programs and even prefix matches such as `pytestanything`. Execution uses shell=True. A token issued for git status successfully ran `git status & echo AUDIT_CHAIN_ACCEPTED` in a temporary repository. Replay was rejected, but action binding was not. Setting a token timestamp 10 hours in the past did not invalidate it. Declared mutating-tool set is not enforced for create_note/open_file, and confirmation tokens are generated/executable through the same unauthenticated API.

**P0 — undisclosed outbound indexing/context.** Remote embeddings/generation can transmit source content; provider UI says chunks remain local. There is no explicit source disclosure approval flow. This is distinct from Groundwork Sync and must be documented separately.

**P1 — filesystem boundaries incomplete.** Open/read/cwd helpers resolve paths and constrain them to registered roots, a useful safeguard. Index scanning/single-file indexing and overview reads do not consistently apply canonical boundary/eligibility validation. File symlinks can be followed by parser reads according to code; creating a symlink was blocked by Windows privilege error 1314, so runtime symlink escape is unverified. Root registration has no sensitive-directory policy; arbitrary supported files inside roots can be read, including `secret.env`. Dotfile `.env` itself is not supported by the current suffix check, despite parser claims. Full-file tool reads are unbounded; executable/default-handler opens are not a general safe inspection operation. Rust reveal command has no workspace validation.

**P1 — cloud credentials.** Password hashing is SHA-256 with one hardcoded salt, not a per-user slow password KDF. A shared development JWT signing secret is accepted without production guard. Registration accepted an invalid email and empty password in the fixture. No refresh/revocation, login throttling or account/device authorization controls beyond bearer user scope were found. Tenant scope does work for the tested happy path.

**P1 — exposure/deployment.** Compose publishes local core and database ports on all host interfaces; startup script binds all interfaces. Old deployment targets local core instead of cloud sync. Tauri CSP is disabled. No external credential values were revealed, and no remote exploit/live secret-validation test was conducted.

## 16. UI/UX inconsistencies

Fresh desktop render is fundamentally broken before design judgement: utility layout, widths, spacing, type sizes and modal positioning are absent. The paper grid/tokens survive, but the interface becomes a top-left unstyled flow. This is not evidence that the palette itself needs replacing.

After accounting for that build defect, current design still differs from historical web workflows: fixed feature-list sidebar replaces workspace tree/collapsible source panels; project cards and large empty states replace an evidence workspace; AI lives on a separate page; telemetry/provider/retrieval terms dominate. The old three-pane sources → canvas → assistant interaction, breadcrumbs, resizable panels, formatted answers and theme toggle were discarded. Cards are nested inside citation/overview cards; every result repeats buttons and numeric ranking diagnostics. Search is a transient modal rather than the primary persistent working surface.

| Core workflow | Current intended path / approximate actions* | Defect and data status |
| --- | --- | --- |
| Find something | Search shortcut → type → Enter/open (about 3) | Real file index; no unified project/Git/note search despite placeholder; no persistent inspect pane; stale request races/errors only console |
| Understand project | Projects → Overview (2), or Investigate → enter question → submit (~4) | Real manifest/README/commit metadata; nested attribution wrong; key files not rendered, working tree absent; query doesn't automatically include overview |
| Resume yesterday | Timeline → choose period/read summary; Resume Work → resume/expand (~2–4) | Real observed records/mtimes/sessions; summary global despite project selector; mtime is not proof user worked; Git/search/open events not recorded |
| Investigate failure | AI Context → type → deep-mode toggle → submit (~4) | Single-pass retrieval and default prompt extraction; fabricated citation description; errors and log context not captured by UI |
| Continue project | Header select → Resume Work → resume → expand (~4) | Status changes persist; it does not restore AI question/files/provider or reopen a working context |
| Ask about selected result | Search → type → choose → AI Context → retype question → submit (~6) | Selected query/file lost; “Save as Note” has no implementation; no trustworthy source selection |

*Counts exclude typing each character and first-run setup, and describe handlers; the CSS failure prevents treating them as a validated native daily-use flow.

First-run setup is buried in Settings and requires a typed full folder path without native picker or clear indexing/error completion. Projects fetch once and can remain empty after background scan finishes. Header polling conflates unrelated API failures with core-offline status. Settings load failures are console-only; all action messages use a green success container, even skipped/error sync outcomes. Notes cannot be edited and their selected detail can remain stale after filters change. Resume status/todos persist, but notes/goals/files aren't editable in that screen. Session checkbox accessibility and global search dialog focus/ARIA require work; reusable Modal has better focus handling but React-node titles lack an accessible label. Desktop drops web reduced-motion support and does not wire dark theme.

## 17. Existing web design system

Current source identity is paper/editorial with technical annotations. Preserve it:

| Design element | Actual reference |
| --- | --- |
| Typography | Georgia/Times serif display; Inter/system sans body; JetBrains Mono/system mono annotations. Google Fonts links in HTML, no bundled font assets. Base 14px; token sizes 10/11/12/14/15/17/20/24/30/38px; line-height 1.22–1.7 |
| Palette | paper #f2ede2, subtle #e8e0d2, surface #fffaf0, navy ink #112038, secondary #4a5360, cobalt #22569e, agent orange/sepia #de4f33, green signal #65a98f |
| Borders/background | Warm hairlines #d9d0bf/#bcb09e; 32px low-contrast paper grid. Navy inverse “control-room” surfaces; restrained semantic feedback |
| Spacing | 4px-based tokens, 8/12/16/24/32px common spacing. 34px default controls, 48px historical workspace header, 260px historical sidebar |
| Shape/shadow | 3/5/7/9/12px radii; hairline cards, subtle contact shadows, stronger popover/modal elevation |
| Navigation | Current marketing navy 56px header, serif wordmark, small mono descriptor and Lucide icons; historical workspace compact breadcrumb header, collapsible navigation/source panels |
| Components | Historical Button, Badge, Input, Card, Modal, EmptyState, Tabs, PanelHeader, ResizablePanel, InlineCitation and FormattedAnswer available at commit e1af73d |
| Interactions | Hover-revealed actions, keyboard palette, selected rows, focus rings, source chips/tooltips, source/canvas/assistant hierarchy |
| Motion | CSS inkSettle/inkDryTransition for agent prose, small fade/zoom transitions; reduced-motion handling in web styles. Definition alone does not mean current marketing uses all motions |
| Density/personality | Calm manuscript surface with compact technical controls, evidence led rather than telemetry/dashboard tiles |

Current `client/` no longer includes the old workspace components, so “reuse existing web UI” requires both present tokens/assets and Git history. I inspected historical Sidebar/TopBar/Button/Card and workspace composition at e1af73d, and viewed `client/public/groundwork-workspace-real.png`. That retained screenshot uses an older cool blue/purple treatment and should not silently override the current warm token source. Preserve structural patterns and reconcile reference version explicitly during reconstruction.

## 18. Recommended UI reconstruction

First repair Tailwind compilation and establish screenshot checks; do not redesign around the unstyled result. Keep the warm paper, navy/cobalt/sepia palette, serif headings, sans body, mono source annotations, small radii and Lucide language. Recover historical primitives/layout patterns without restoring upload/auth/RAG flows.

Use a compact left navigation/project tree, main Search/results surface, and source inspector with contextual Ask Groundwork pane. Search should be the initial working surface with useful recent items and first-folder action. Retain Ctrl+K as an in-app command palette and implement a separate native shortcut only when supported/tested.

Result selection should retain query, absolute file, exact range and project through inspect → ask → save session. Put Git/status/recent work into project context rather than separate dashboard metrics. Sessions should reopen persisted investigation content and unfinished tasks. Notes should have an editable manuscript pane. Settings should explain meaningful local/remote data choices and show actual provider/readiness/sync errors. Bundle fonts/assets for consistent offline identity.

## 19. Tests that actually pass — commands and results

Commands below used installed dependencies only. Python processes set PYTHONDONTWRITEBYTECODE=1; pytest disabled cache. Frontend output redirected to external TEMP directories.

| Command / location | Actual result | Limit / likely cause when blocked | Severity |
| --- | --- | --- | --- |
| `python -m pytest -p no:cacheprovider -q tests` in server | 18 passed, 3.05s | Existing suite, not packaged workflow coverage | — |
| Same command in cloud | 1 passed, 7.76s | SQLite override, no live PostgreSQL/model/deployment | — |
| `python -m pytest -p no:cacheprovider -q server/tests` from root | 8 collection errors | ModuleNotFoundError app; server config chosen without import path | P2 |
| `node_modules/.bin/tsc.cmd --noEmit` in desktop | Pass | Type safety does not verify CSS/API semantics | — |
| `node_modules/.bin/vite.cmd build --outDir <TEMP>/groundwork-audit-desktop-build --emptyOutDir false` | Pass with unknown @theme/@tailwind warnings | Missing Tailwind compiler; visually broken | P1 |
| Same TS/Vite checks in client, external output | Pass | Deprecation warning only for build | — |
| `node --test tests/rendered-html.test.mjs` in client | 4 passed | Reads existing dist shell and source strings, not rendered React/workflows | — |
| `eslint.cmd . --no-cache` in client | 1 error, 13 warnings | no-explicit-any at LandingPage:145; unused imports | P2 |
| `ruff check --no-cache server cloud --output-format concise` | 20 errors | Imports/unused code/evaluation late imports | P2 |
| `playwright.cmd test --list --reporter=line` | No tests found | Existing E2E files already deleted | P1 coverage gap |
| `vitest.cmd run --passWithNoTests=false` | No test files | Config expects .test.ts; present tests are .mjs Node tests | P2 |
| `npm run tauri -- --version` | Fails, tauri not recognized | CLI dependency missing | P1 |
| `cargo check --offline` | Cannot execute | Cargo/Rust not installed; native compile outcome unverified | Environment blocker |
| `python -m pip check`, global and server venv | Pass | Global environment has extra undeclared packages | — |
| AST parse of server/app and cloud/app | 43 files parse | Syntax check, no static type checker configured | — |
| `docker compose config --quiet` | Pass | Configuration only, no image build/start | — |
| `docker info --format '{{.ServerVersion}}'` | 29.8.0 | Confirms engine available only | — |
| Evaluation functions invoked through `python -c` | Lexical 80/86.7% top1/top5, MRR .842, 2.08ms; semantic 100/100%, MRR1, 43.09ms; hybrid 100/100%, MRR1, 9.4ms | 15 curated queries on own small server source corpus | — |

Additional executed probes are described in sections 3–15: live watcher lifecycle, ignored/new roots, rapid events, stale index content, real repo searches/Git, oversized/binary initial skipping, 1,051-file truncation, invalid citation ranges, harmless command chaining/action mismatch/replay/expiry, remote AI transport capture and failure reporting, sync field loss/zero acknowledgement/unknown entities/setting deletion, and untrusted-origin/cloud authentication checks. These were temporary diagnostic programs, not committed tests.

Browser verification used installed Playwright Chromium against fresh external builds at 1180×780. Font internet requests and local API requests were blocked for layout isolation; this deliberately tested the disconnected state, not a live desktop/server fullstack workflow. Screenshots accompany this report.

**Unverified:** native Tauri compilation/dev/start/shutdown, installer launch without Python/Node/Git, real remote LLM/Ollama calls, live PostgreSQL/Cloud Run, Docker image builds, full offline native workflow, symlink runtime escape, hard-killed indexing recovery, and large real-world corpus relevance/latency. Docker/native builds were not used to install/generate dependencies during the read-only audit.

## 20. Tests/benchmarks that are misleading

- Current benchmark is not the removed tiny synthetic dataset: it really indexes server Python source. However it is still only 15 hand-selected queries on a small self-referential corpus, many containing exact class/API terms. 100% top1 hits here cannot establish broad semantic understanding or production quality.
- “Recall” calculates whether any expected file appears, not full recall across multiple relevant files. Lexical mode also includes filename retrieval. Latency is a single small-corpus run, without percentile/load/memory/freshness coverage. Report conclusions are hardcoded even if measurements fail.
- Checked-in report says hybrid 21.06ms; root/docs cite 9.4ms. This audit happened to measure 9.4ms, but that does not reconcile histories or prove a sub-10ms guarantee.
- Live-audit tests mostly index only app/core, verify citation starts fall inside a file, and check a metadata helper's top-level keys. They miss line-end/snippet correctness, actual outbound queue content and security binding/expiry.
- API test constructs TestClient without a lifespan context, so it does not validate normal watcher startup/shutdown. Git test title claims commit indexing but asserts repo/status behavior only. Activity test inserts its own events, not actual Git/search/open capture.
- Frontend “rendered HTML” tests inspect an empty root shell and source regex strings. They pass fake downloads and privacy claims, and never catch broken desktop CSS. Historical test-result directories are stale evidence. CI builds frontend bundles but never compiles/packages Rust or checks installed-app lifecycle, lint, current E2E behavior or PostgreSQL sync.

## 21. Critical fixes

1. Authenticate and constrain local IPC/API; require trusted process/origin/host identity, loopback-only launch paths and user-authorized workspace registration.
2. Replace shell execution policy with validated argv and exact-action/cwd-bound, expiring, single-use confirmations. Enforce mutating tool permissions centrally; do not classify arbitrary tests/scripts as benign inspection.
3. Make indexing local-only by default independent of generation provider. Add explicit data-disclosure choice before remote AI and accurately describe notes sync and provider fallback.
4. Restore CSS compiler and reference visual checks. Preserve historical design language.
5. Implement bundled backend/runtime ownership, readiness handshake, safe port discovery, crash handling and shutdown; include Git availability strategy. Validate real Windows installer without development tools.
6. Centralize canonical file eligibility/ignore rules for scan, watcher and read tools; reconcile stale records and root/project changes.
7. Repair retrieval exactness, provenance and citations; preserve search-to-AI context; expose honest provider/unavailable/no-evidence states.
8. Replace unsafe cloud password/default-secret handling and data-loss-prone sync transport; retire the old deployment path before a release/deploy.

## 22. Medium-priority fixes

Add versioned local/cloud schema evolution; proper nested project ownership and freshness; independent scalable vector retrieval/model tracking; metadata filters and unified result types; Git file history/diff refresh and date normalization; real activity event attribution; persisted complete investigation/session content; editable notes/tasks; queue retries, tombstones, pull/apply and conflict resolution; bounded API/tool inputs and file reads; consistent response models and API error states; dependency cleanup, coherent Node/Python setup docs, missing PDF dependency and deterministic CI installs.

## 23. Polish items

Reduce card nesting and diagnostic labels; standardize text/control sizes; expose selected/focus/hover state consistently; accessible search dialog/results and labelled icon controls; proper note/session forms; restore theme/reduced motion; selectable source text; native folder picker; useful empty/error/loading states; bundle fonts/favicon/logo; accurate Today/timezone labels; hide release downloads until real artifacts exist; verify small-window/keyboard layouts and sentence-level privacy claims.

## 24. Proposed implementation order

1. **Safety and contracts:** local authenticated transport, bounded tools, command consent, remote disclosure, cloud password/secret guard; reconcile API DTOs.
2. **Runnable desktop:** package backend/runtime, implement supervised lifecycle/handshake and real Windows smoke test. Wire a trustworthy startup/error/retry experience.
3. **Data correctness:** common ignores/canonical paths, content hashing/stale eviction, root refresh, project ownership, watcher restart/catch-up and schema migration.
4. **Retrieval and provenance:** correct FTS ranking/lines, independent local vector retrieval/model tracking, scale coverage, source-backed citations and honest no-evidence/provider errors.
5. **Primary UI:** compile Tailwind, share/recover web primitives, reconstruct Search → inspect → ask with project context and screenshots against the reference.
6. **Working memory:** real Git/current-tree/history, activity capture, editable notes, durable full sessions and resumed context.
7. **Optional sync:** coherent auth/pairing, item acknowledgements/revisions, safe update semantics, pull/apply/tombstones/conflicts/offline retries. Keep local workflows independent.
8. **Release discipline:** remove documented obsolete files/dependencies, replace old Cloud Run worker deployment, update docs/claims, run actual desktop/files/Git/AI/cloud user workflows and build an installer from clean locked inputs.

Acceptance should be demonstrated by a person installing/launching/searching/editing/resuming real work, not a feature checklist or small-corpus score.

**Approval boundary:** per the user's attached request, stop after Phase 1. No reconstruction, repository cleanup, dependency installation or Phase 2 changes have been started.
