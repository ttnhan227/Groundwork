# Groundwork continuation validation — 5 October 2026

Existing uncommitted implementation was preserved. Work stayed in development mode; no installer, release, tag, publication, or source-file organization outside temporary fixtures was performed.

## Changes

- Metadata inventory avoids a redundant Windows junction check for ordinary entries, using already-read reparse attributes. Junction-loop safety remains tested.
- Interrupted copies count as failures even when both versions must be retained. Recovery history reconstructs completed/skipped/failed counts. The destination's actual checksum and size are verified before deleting the original.
- Copying and undo can be cancelled. Partial destinations are removed while originals remain; already completed operations remain journaled and can be undone. Cancelled undo counts only files actually restored.
- Custom categories leave unmatched files unchanged. Date reasons identify the last modified date. Bulk inclusion changes invalidate the old preview. Saved rules preserve the chosen date/type method. Suggestions preserve exclusions and choices to leave files unchanged.
- Guided examples use a fresh temporary folder each time and register it for preview access.
- Content organization supports built-in llama.cpp and optional providers, with cloud disclosure. It retrieves a contiguous section of up to 40 lines using instruction keyword matches and bounds excerpts to 6,000 total characters across at most six files. Coverage includes actual line ranges and character limits. Unreadable-only selections return unchanged without loading/contacting AI.
- Saved preferences can be reused. Destination subfolders can be entered explicitly inside added roots. Organization selections render in pages of 100; reviewed plans remain limited to 100 files.
- Existing visual identity retained: compact narrow-window navigation, wrapping controls, readable extension badges with consistent Lucide format icons, responsive file metadata, accessible names, and reduced-motion styling.
- Website guides distinguish filename browsing from content preparation, explain preview/apply/undo, and disclose that development features can be newer than published installers. Stale website assertions about nonexistent 1.0 installer filenames were replaced.

## Measurements

Separate temporary fixture trees and isolated SQLite databases were used. Files contained synthetic text. Times below exclude fixture creation and model/content indexing. These are two local runs, not a statistically controlled storage benchmark.

| Files | Earlier cold scan | Revised cold scan | Earlier rescan | Revised rescan | Revised first file batch | Browse | Name search |
|---:|---:|---:|---:|---:|---:|---:|---:|
| 100 | 0.0148 s | 0.0053 s | 0.0100 s | 0.0039 s | 3.3 ms | 1.7 ms | 2.0 ms |
| 5,000 | 0.7475 s | 0.3031 s | 0.5417 s | 0.0704 s | 3.1 ms | 2.3 ms | 9.9 ms |
| 25,000 | 4.1214 s | 1.0453 s | 3.3001 s | 0.3580 s | 57.1 ms | 1.2 ms | 27.1 ms |

A cProfile run on 5,000 files measured 0.528 s inside inventory scanning. Batch database writes accounted for 0.182 s cumulatively, while suffix extraction/path construction accounted for roughly 0.123 s cumulatively. Profiling overhead makes this run unsuitable for direct comparison with the table. First-batch timings measure the service callback after committed discovery, not screen paint.

## Verification

- Full backend suite: 135 passed (36.41 seconds)..
- Targeted organization/rule tests: 21 passed, covering approval, preview invariance, collisions, changed files, interruption retention, cancellation during copying, partial undo/retry, unmatched categories, relevant later sections, and no-provider behavior for unreadable files.
- Desktop TypeScript/Vite build passed. Native Tauri debug build compiled and launched; its actual organization screen was inspected at desktop size.
- Website TypeScript/Vite build and four website shell/copy checks passed. These checks do not substitute for UI testing.
- Rendered browser workflow: created a fresh guided fixture, generated type suggestions, reviewed its virtual tree, saved a type rule, moved four synthetic files, and undid all four with correct counts. A second fixture verified that an excluded file remains unchanged while date rules affect included files only.
- Browser/native screenshots reviewed: desktop organization, narrow organization controls and dialog, website landing/documentation/download loading state. After correction, DOM inspection found no controls extending beyond the narrow organization viewport.
- Keyboard check: Tab from the final preference-dialog control returned to its close button; Escape closed the dialog and restored focus to Saved preferences.
- Git diff whitespace check passed.

## Remaining limits and validation

This is a meaningful continuation, not certification that every requirement is complete. The file browser uses bounded server paging rather than a continuously virtualized list. Organization previews allow 100 files; content suggestions allow six. Saved-rule discovery currently covers direct children, so nested-folder rule reuse still needs expansion. Destinations must be inside an added folder; an arbitrary unregistered drive is rejected.

Relevant-section retrieval is lexical, not semantic. The llama.cpp runtime also checks its actual token limit; unusually dense excerpts can still require a smaller selection. No fresh real model download, checksum/resume interruption, imported-GGUF inference, or cloud-provider call was run in this pass. Existing model-management tests passed; live inference quality remains unverified.

Cross-drive, power-loss recovery, Windows ACL behavior, very large/cloud/network collections, display scaling/increased text sizes, and the complete native workflow at multiple window sizes still need dedicated validation. Copies preserve bytes and modification times; destination ACL inheritance remains a known boundary. Cancellation checks occur during copy chunks and between operations, with hashing/verification potentially delaying response. OCR, image understanding, and transcription remain unavailable. No data-deletion workflow was added.

The native development app is left running. Intermediate scripts, fixture API data and profiles are under the repository's work directory. Benchmark temporary file trees were automatically removed. Native development uses its existing separate development data location.
