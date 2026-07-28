# InsightPDF Version 2.5 Product Roadmap

## Release focus — AI-first document workspace

Version 2.5 is a focused experience release between the completed Version 2
document platform and the organization/workflow direction proposed for Version 3.

The goal is:

> Make uploading a document and getting a grounded, useful AI answer feel immediate,
> discoverable, trustworthy, and consistent on desktop and mobile.

Version 2.5 reuses existing Version 2 capabilities instead of rebuilding them.

## Existing capabilities retained

The following requested capabilities already exist and should be refined rather
than duplicated:

- Document chat
- Multi-document chat
- AI summaries
- Page-level citations
- Filename search and workspace filters
- AI document comparison
- Unified document workspace
- Conversation history
- Summary, translation, extraction, and quiz tools
- Document previews and thumbnails
- Loading indicators and background processing jobs
- Responsive layouts

## Version 2.5 committed additions

1. AI-first signed-in home with prominent upload and prompt entry points
2. Drag-and-drop PDF upload with clear validation and progress feedback
3. Suggested prompts after upload and contextual follow-up suggestions after answers
4. Search inside an open document
5. Citation navigation that passes source text into the viewer for highlighting/search
6. Lightweight collections for organizing documents
7. One-click AI actions on ready document cards
8. Dark mode with saved system/user preference
9. Smoother progressive answer rendering and explicit generation state
10. AI-generated document title and tags with manual refresh
11. Export for conversations and AI results
12. Recent-document and recent-activity panels
13. Keyboard shortcuts for search, upload, theme, and escape/close behavior
14. Mobile refinement for the workspace, viewer, chat, and action surfaces

## Phase 1 — AI-first entry and upload

- Replace the passive workspace introduction with an action-oriented AI home
- Add drag-and-drop upload
- Preserve the standard file picker
- Show accepted formats and limits
- After upload, show suggested questions and one-click AI actions
- Keep processing visible until the document is ready

### Exit criteria

- A first-time user can upload without searching for a button.
- Dropped invalid files show an actionable error.
- A ready upload can open chat or an AI action directly.

## Phase 2 — Grounded chat refinement

- Contextual prompt suggestions for new chats
- Follow-up suggestions after each assistant answer
- Progressive answer rendering
- Export conversation as Markdown
- Maintain multi-document labels and history
- Pass citation snippets into the viewer

### Exit criteria

- Suggested prompts never trigger automatically.
- Export includes document names, messages, and citations.
- Clicking a citation opens the correct page and searches/highlights supporting text.

## Phase 3 — Document discovery and organization

- Search inside open PDFs
- Collections with create, assign, filter, rename, and delete
- Recent documents
- Recent activity from uploads, generated files, chats, and jobs
- AI-generated display title and tags
- Manual metadata refresh with visible usage warning

### Exit criteria

- Collection filtering does not hide or duplicate files incorrectly.
- Generated metadata remains editable through ordinary document rename/tag controls.
- Recent activity links to the relevant document or operation.

## Phase 4 — Interaction and visual polish

- Dark mode
- System theme detection
- Persisted theme preference
- Keyboard shortcuts
- Mobile action layout
- Accessible upload and suggestion controls
- Reduced-motion support
- Consistent empty, loading, success, and failure states

### Exit criteria

- Core flows work at mobile width.
- All shortcuts have equivalent visible controls.
- Dark mode preserves readable contrast and document previews.
- Motion respects reduced-motion preference.

## Definition of done

Version 2.5 is complete when:

- Existing Version 2 features remain functional.
- Every committed addition above has automated or browser coverage.
- Upload, chat, citation, AI action, collection, export, and theme flows are tested.
- The application passes frontend build, lint, backend tests, and Docker health checks.
- Paid live-AI tests remain opt-in and usage-limited.
- No feature creates an unbounded background or LLM request path.

## Explicitly deferred to Version 3

- Organization memberships and roles
- Shared team libraries
- Review and approval queues
- Business extraction templates
- Workflow rules
- Email ingestion
- External drive connectors
- Public API keys and webhooks
- Billing and commercial organization plans
