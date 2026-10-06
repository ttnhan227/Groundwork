# Groundwork 1.0.0 release readiness

Prepared on 2026-10-06. Publication remains the owner's action. Signing is optional by the owner's decision. The owner reports Google sign-in and clean Windows testing passed; those results are recorded as owner-provided acceptance evidence.

## Changes in this final pass

- Access-denied and cancelled scans recalculate folder metrics from retained database rows instead of incomplete traversal totals. A real Windows ACL denial and nested-folder regression confirm cached bytes remain coherent and the inventory is labeled partial.
- The desktop workspace shows content-index preparation and checked-file counts separately from completed storage discovery, with Stop/Resume indexing in the footer. AI supports Ctrl+Enter; permission/missing-item errors give usable recovery instructions.
- Selected-file details query allocated bytes and hard-link count on demand. Ordinary files use Windows FileStandardInfo; sparse/compressed files query actual committed storage. Cloud placeholders are skipped to avoid hydration. Primary-stream allocation excludes alternate streams and filesystem metadata. Whole-folder totals remain logical; this is not MFT scanning or a whole-disk physical allocation claim.
- CI discovers the generated versioned installer, defaults to the configured public Cloud Run URL, tests an isolated native scanner fixture, and includes actual metadata-scale/ACL/WAL recovery plus larger content/crash recovery. Source versions are prepared as 1.0.0. Signing remains supported when credentials are supplied, but absent credentials no longer block stable builds.
- Concurrent watcher/background insertions reuse SQLite's retained file identity; a source-version check inside the write transaction prevents old parsed content overwriting a newer watcher update. Deterministic concurrency tests verify chunk/FTS identity and newest-content preservation.
- Scan/Resume sends the list body required by the indexing API. The native workflow verifies HTTP success from both clicked controls, so watcher activity cannot mask a rejected request.
- Explicit resume during cancellation is queued until the current operation finishes. Watcher events cannot revive a cancelled run; stale watcher requests no longer force an extra full scan. Deterministic interleaving regressions cover both cases.
- Validation uses disposable backend state and WebView2 profiles. Scratch fixtures and migration backups are ignored by Git.

## Verification

| Check | Evidence |
|---|---|
| Local backend | 159 tests passed; Ruff passed |
| Hosted backend | 21 tests passed |
| Desktop | TypeScript/production build, onboarding and release-version consistency passed; real WebView2 Scan/Stop/Resume indexed 400 documents with successful control requests |
| Native Rust | Isolated filesystem scanner test passed |
| Website | Build, 10 rendered/release UI tests, and ESLint passed |
| Metadata storage stress | 25,000 real files; abrupt process/WAL recovery; actual Windows ACL denial; 600 watcher mutations; 25,200 final files and exact logical bytes verified. Recovery metadata scan: 1.110 seconds on this machine. |
| Content scale/recovery | Passed: 10,001 searchable documents; actual process-tree termination during indexing; startup reconciliation; lexical and trained semantic retrieval; exclusions; 30 rapid edits; changed ignore rules; explicit reindex. Cold crash-recovery content preparation took 343.984 seconds under concurrent release/testing load. The interface remains available during background preparation. |
| File preservation | NTFS streams/creation/security, changed-file/collision/cancellation checks and a real read-only-file failure passed; original contents remain preserved. |
| Frozen functional/sync | Startup, search, watcher mutations, Git, AI citations, approved organization move/undo, confirmation, persistence, tenant isolation, path rejection, cloud outage and queue retry passed |
| Live hosted email/sync | Disposable account registration, logout, login and sync passed against the owner's Cloud Run backend. Synced note verified; private workspace paths excluded. |
| Upgrade | Isolated 0.1.0 to 1.0.0 upgrade passed: notes, saved AI findings, added workspace and exact original file contents preserved; new allocation and keyboard AI controls passed. The exact final installer also passed Scan/Stop/Resume with 400 documents after upgrading. |
| Fresh final installer | Passed on the final unsigned 1.0.0 installer: silent install, empty PATH, native startup, single-instance activation, search, AI save/resume and Ctrl+Enter, compact/expanded panels, notes, engine restart, app shutdown/relaunch, storage details, live email/sync, and real Scan/Stop/Resume with 400 documents |
| Google sign-in / clean Windows | Passed according to owner |

Live disposable test accounts contain fixture notes only and were signed out. The service currently has no account-deletion endpoint; the test does not claim that the accounts were removed.

## Scope and limits

Metadata discovery and searchable-content preparation are separate operations. Trained semantic content indexing can take minutes for thousands of files; the interface stays available and shows progress. The 25,000-file metadata result is not a promise for millions of files, every network share, or every storage device. No whole-drive MFT/allocated-total feature is advertised. No universal bug-free guarantee is made.

Storage API definitions: [Microsoft FileStandardInfo](https://learn.microsoft.com/en-us/windows/win32/api/winbase/ns-winbase-file_standard_info), [Microsoft compressed/sparse file storage](https://learn.microsoft.com/en-us/windows/win32/api/fileapi/nf-fileapi-getcompressedfilesizew).

## Publication validation follow-up

The owner authorized publishing 1.0.0 on 2026-10-06. Hosted CI exposed two issues before publication: a development-URL test inherited the release-mode flag, and Windows short-path aliases were not normalized for inventory browsing. Both are fixed. All 159 backend tests pass with CI mode enabled. The 25,000-file storage rerun passed ACL denial, abrupt WAL recovery, 600 mutations, and exact final bytes (1.453 seconds for recovered metadata discovery).

Premature 1.0.1/1.0.2 candidate tags were removed at the owner's correction; neither had a published release. The intended release remains 1.0.0. Its unpublished tag will point to the final corrected commit after validation. The installer hash above records the earlier local candidate; the release workflow rebuilds and tests the final artifact before publication.

## Original publication handoff

The application, installer and backend version are prepared as 1.0.0. Final unsigned installer SHA-256: `2540c4285c373cc9949e0781d951ba29ff850b6056a68ecaa3499c04111974c1` (169,795,459 bytes). Nothing has been committed, pushed, tagged, deployed or published in this pass. Review and commit all intended source changes, including newly created application/services/tests, while excluding local .env files, generated binaries and scratch state. The release workflow must run from that complete commit.

When ready, create and push a new `v1.0.0` tag according to [release automation](RELEASE_AUTOMATION.md). That tag triggers the verified build and publication workflow; the website reads the published release metadata automatically. Use a new tag if v1.0.0 already exists. No signing credentials are required under the selected policy.
