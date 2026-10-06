# Groundwork desktop workspace redesign

Implemented 2026-10-05 in the existing Groundwork checkout. Existing unrelated edits were preserved.

## What changed

Groundwork opens directly into Files & storage. The previous website-style home page, large navigation rail, and stacked folder cards were replaced in the desktop shell by compact system-font toolbars, a persistent folder tree, a sortable directory table with expandable children, storage categories, selection details, independently scrolling panes, and a status bar. Folder and project navigation now share the left pane. Tool panels open alongside the file workspace and preserve its location, query, and selection.

Search is always visible. Typing updates results without Enter, with a 120 ms debounce for text and immediate requests for clicks. Existing results remain dimmed while an updated result arrives, avoiding a blank table between queries. Responses from superseded queries are ignored. Folder clicks preserve the query and change its scope. Category and extension controls filter directly. Scope choices are This folder, Entire location, and All locations. Basic filename wildcards such as *.pdf work. Largest files and Recent are one-click queries. Indexed content search remains available through Contents or Ctrl+Shift+F and opens with the current query already entered.

The native Choose folder command uses the Windows picker, derives the location name, and starts scanning automatically. Existing locations are reused. The browser development fallback retains a path dialog. Filesystem changes refresh automatically; Scan and Stop scan provide explicit controls. A location can be removed from Groundwork through its context menu, with confirmation explaining that original files remain in place.

Rows support click, Ctrl-click, Shift-click, Ctrl+A on the current page, double-click to open, keyboard arrows, Enter, Shift+F10, and Escape. Right-click actions include Open, Show in Explorer, Copy path, Search in this folder, Find same file type, Ask, and Organize. Folder breadcrumbs, back/forward history, Alt+Left/Right, and up navigation remain available. Pane splitters support dragging and keyboard resizing.

## Backend

Inventory browsing now supports folder-only children, recursive folder scope, basic name wildcards, minimum size, and modification time. All-location search pages active inventories centrally rather than concatenating client-side pages. Category summaries remain cached; browsing does not run GROUP BY over inventory. A single bounded lookup of cached folder rollups supplies immediate-parent percentages for flat search results across locations. Bounded pages use 200 rows, with explicit paging and additional-child loading.

## Verification

- 137 backend tests passed; desktop TypeScript check and production build passed.
- Added regression coverage for recursive scope boundaries (Project versus ProjectOther), uppercase wildcard matches, folder-only pagination, size/date filters, cross-location sorting and pagination, immediate-parent sizes, inactive locations, and absence of GROUP BY during browse.
- Live HTTP checks returned the second location's result with its correct parent size; invalid sort, page limit, and negative offset returned 422.
- Rendered browser checks used 41 synthetic files across two locations. Typing notes found 13 matches in Documents; clicking Projects preserved the query and found 12. Cross-location search found other-report.txt; its context action navigated into the correct second location.
- Expanded directory rows showed children in place and correct parent shares. Category and extension clicks filtered correctly. Shift-click selected three files; Assistant opened beside the retained file workspace with those three files. Indexed content search found 24 matching passages. Splitter keyboard resizing, direct search focus, Shift+F10, and Escape were verified. No browser console errors were recorded in the final check.
- The actual Windows app was visually inspected against its existing 4,418-file inventory and restarted with the final backend and frontend. Native picker code uses the existing Tauri command; this run did not complete a native picker interaction because user input interrupted that check.

The development app and its Vite server are running as separate processes, so they do not depend on an attached terminal session. No installers, releases, or tags were created. This redesign uses the existing inventory scanner; it does not introduce WizTree's NTFS MFT scanning engine.
