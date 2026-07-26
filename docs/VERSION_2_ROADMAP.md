# InsightPDF Version 2 Product Roadmap

## Updated release focus — Document Preparation Copilot

Version 2 is intentionally narrowed to one complete, commercially testable
workflow:

> Prepare PDFs for safe external sharing from one plain-language request.

The release loop is upload → inspect → propose → approve → execute in order →
verify → download with a change report. InsightPDF will first serve operations,
legal, HR, and compliance users who repeatedly prepare document packages.

### Version 2 committed scope

1. A registered, schema-validated catalog of deterministic preparation tools
2. Natural-language planning with visible parameters, risk, cost, and verification
3. Explicit approval for destructive or sensitive steps
4. Ordered execution against copies; original files are never overwritten
5. Compression, rotation, page removal/extraction, numbering, and watermarking
6. Blank-page, orientation, and sensitive-text inspection with user correction
7. Permanent redaction with extraction-based verification
8. Multi-file batch execution with per-file outcomes
9. Downloadable prepared PDFs and human-readable change reports
10. Saved reusable preparation presets

### Release sequence

- **V2 Preview:** safe planning, ordered execution of core preparation tools,
  per-step PDF validation, downloadable results, and embedded change-report data.
- **V2 Beta:** document inspection, reviewable redaction, batch preparation, and
  visible change reports.
- **V2 Release:** saved presets, recovery, accessibility, security testing, and
  validation with recurring real-user workflows.

### Explicitly deferred

Arbitrary PDF content editing, broad annotation, full Office conversion parity,
form creation, personal signatures, signature requests, and consumer-style
collections of every PDF utility do not block Version 2. They will be reconsidered
only when repeated customer behavior supports them.

The broader plan below remains a capability reference, not the Version 2 release
commitment.

## Product direction

Version 1 established InsightPDF as an AI-powered PDF workspace. Version 2 will
turn it into an AI document copilot and a complete, everyday document platform.
Users should be able to describe an outcome in natural language and let
InsightPDF inspect the files, propose a safe plan, execute the necessary tools,
verify the result, and explain what changed. The same tools remain available
manually when the user wants exact control.

The goal is not feature-count parity with every established PDF product. The
goal is a coherent end-to-end workflow:

> Ask → inspect → plan → approve → execute → verify → download or share

AI is the primary assistance layer, not the implementation of every operation.
The model interprets intent and chooses tools; deterministic application code
performs compression, conversion, page editing, encryption, signing, and other
document changes. This keeps workflows affordable, predictable, and testable.

## Version 2 release boundary

Version 2 is considered complete when the following product areas are shipped:

1. Natural-language planning and multi-tool automation
2. AI-assisted document inspection, editing, extraction, and review
3. PDF compression and page finishing
4. Visual PDF editing, annotation, and redaction
5. Office document conversion
6. Password security, forms, and personal e-signatures
7. Batch operations, saved files, and share links
8. A unified AI and manual tool experience

Team administration, paid subscriptions, signature-request workflows, and
native mobile apps are post-Version 2 expansion areas. They should not block the
core Version 2 release.

## Product principles

- Every tool must produce a previewable, downloadable result.
- Every tool must expose a structured contract that the AI orchestrator can call.
- AI plans are visible and editable before execution.
- Sensitive, destructive, security-related, or externally shared actions require confirmation.
- Deterministic tools execute document changes; AI interprets intent and handles semantic decisions.
- The system never claims success until output verification passes.
- Users can switch from an AI-generated plan to manual settings without starting over.
- Original files are never silently overwritten.
- Destructive changes require a preview or explicit confirmation.
- Long-running work is resumable and visible in processing history.
- Batch tools behave consistently with their single-file equivalents.
- Tool limits, supported formats, and fidelity limitations are stated before processing.
- AI is optional for standard document operations.
- Accessibility and keyboard operation are acceptance requirements, not polish tasks.

## AI automation architecture

Version 2 uses a hybrid execution model:

1. **Intent:** the user describes the desired result in natural language.
2. **Inspection:** the app gathers safe document facts such as page count,
   dimensions, searchable text, form fields, encryption, blank-page candidates,
   and file size.
3. **Planning:** AI converts the request into a validated structured workflow
   using only registered application tools.
4. **Clarification:** the assistant asks a targeted question only when a missing
   choice would materially change the output.
5. **Approval:** the user reviews the plan; risky steps are clearly identified.
6. **Execution:** normal application services and background workers run each step.
7. **Verification:** deterministic checks validate page count, file integrity,
   requested size constraints, redaction, encryption, and other measurable outcomes.
8. **Result:** the assistant summarizes completed changes, warnings, and generated files.

Example request:

> Remove blank pages, rotate any sideways pages, redact email addresses, add
> page numbers, and compress the final PDF below 5 MB.

Example internal plan:

```json
{
  "steps": [
    {"tool": "detect_blank_pages", "approval": "review_selection"},
    {"tool": "detect_page_orientation"},
    {"tool": "find_sensitive_text", "types": ["email"], "approval": "required"},
    {"tool": "apply_redactions"},
    {"tool": "add_page_numbers", "position": "bottom-center"},
    {"tool": "compress_pdf", "target_size_mb": 5},
    {"tool": "verify_output"}
  ]
}
```

The model never invents tool names or sends unvalidated parameters directly to
workers. Plans must pass schema validation, authorization, file ownership,
operation compatibility, and usage-limit checks.

## Phase 0 — AI-ready product foundation

**Purpose:** create the shared workflow and safe tool contracts needed by both
manual users and the AI copilot.

### Deliverables

- Dedicated tool catalog with categories: Convert, Edit, Organize, Secure, Sign, and AI
- Versioned tool registry with input schemas, output schemas, risk level, cost class,
  compatibility rules, confirmation policy, and verification method
- Reusable workflow shell for file selection, options, preview, processing, and results
- Workflow engine supporting ordered steps, dependencies, intermediate artifacts,
  cancellation, rollback where possible, and partial-failure recovery
- AI plan preview showing what will change, why each step is needed, and which
  steps require confirmation
- Per-workflow AI and processing cost estimate before execution
- Recent files and generated files library with search, filters, rename, download, and delete
- Result screen with before/after size, page count, output format, and related next actions
- Job cancellation where the underlying operation can safely stop
- Clear file-size, page-count, format, and usage limits
- Consistent validation and actionable failure messages
- Retention settings for uploaded and generated files

### Exit criteria

- A new document tool can reuse the common upload, job, result, and history flows.
- Refreshing or closing the browser does not lose a submitted job.
- Failed jobs can be retried without uploading the same input again.
- Original and generated files are clearly distinguished.
- A natural-language request can produce a schema-valid plan using only allowed tools.
- Invalid, unavailable, or incompatible tool calls are rejected before execution.
- The same tool produces equivalent output whether launched manually or by AI.

## Phase 1 — Document copilot and automation

**Purpose:** make natural-language assistance the primary way to complete
single-step and multi-step document work.

### 1.1 Conversational command interface

- “Tell InsightPDF what you want” composer available from the dashboard and file viewer
- Commands can target the current file, selected files, a page range, or saved files
- Follow-up instructions can modify a proposed plan before execution
- Conversation retains workflow context and generated results
- Manual tool controls remain accessible from every proposed step

### 1.2 Document inspection

- Detect scanned pages, blank pages, page orientation, duplicate pages, tables,
  forms, signatures, sensitive text candidates, and complex layouts
- Present findings with page references and confidence
- Let users correct detections before modifying a document
- Cache inspection facts and invalidate them when the document changes

### 1.3 Planning and orchestration

- Convert user intent into validated, ordered tool calls
- Resolve dependencies such as OCR before text search or redaction
- Detect incompatible or lossy step combinations
- Pause at confirmation boundaries without losing workflow state
- Resume, cancel, retry, or duplicate a workflow
- Explain why a request cannot be completed and offer supported alternatives

### 1.4 Verification and reporting

- Open and validate every generated PDF
- Compare expected and actual page count, dimensions, text presence, file size,
  encryption status, form fields, and signatures where applicable
- Verify permanent redaction by attempting text extraction and search
- Mark results as completed, completed with warnings, partially completed, or failed
- Generate a concise change report with links to affected pages

### 1.5 Cost controls

- Use deterministic inspection and tools before requesting AI inference
- Use one planning call for ordinary workflows
- Use smaller models for intent classification and parameter extraction
- Reserve stronger models for ambiguous semantic work
- Cache equivalent plans and document analysis
- Enforce per-user AI budgets and show when an operation has no AI cost
- Make optional AI verification distinct from mandatory deterministic verification

### Exit criteria

- A user can complete a supported multi-tool workflow from one natural-language request.
- AI cannot execute unregistered tools or bypass authorization and confirmation rules.
- Deterministic operations do not require an AI call when launched manually.
- Every completed workflow includes verifiable outputs and a change report.
- Planning cost and execution cost are tracked separately.

## Phase 2 — Core PDF essentials

**Purpose:** cover the high-frequency operations expected from a general PDF tool.

### 2.1 Compress PDF

- Basic, balanced, and strong compression presets
- Estimated output quality and size before processing when possible
- Image downsampling, image recompression, metadata cleanup, and font optimization
- Before/after file-size comparison
- Batch compression

### 2.2 Page finishing

- Crop pages with visual handles
- Apply crop to one page, a range, odd/even pages, or all pages
- Add page numbers with position, range, starting number, and style controls
- Add headers and footers
- Resize pages to common paper sizes
- Adjust page margins

### 2.3 Repair and normalize

- Detect malformed or partially readable PDFs
- Attempt structural repair and produce a separate recovered file
- Flatten optional content and normalize rotation/page boxes
- Report unrecoverable pages instead of failing without explanation

### 2.4 Visual page organizer

- Thumbnail grid with drag-and-drop reordering
- Multi-select, duplicate, rotate, delete, and extract
- Insert blank pages or pages from another PDF
- Undo and redo before final processing

### Exit criteria

- Users can complete compression, crop, numbering, repair, and page organization from visual workflows.
- Page order and transformations in the preview match the downloaded output.
- Batch compression reports individual success or failure for every file.

### AI assistance

- Recommend an appropriate compression preset or target based on intended use
- Detect blank, duplicate, rotated, and unusually sized pages
- Suggest crop boundaries while allowing visual correction
- Generate page-numbering and header/footer settings from natural-language requests
- Explain repair findings and confidence without overstating recovery

## Phase 3 — PDF editor, annotation, and redaction

**Purpose:** let users make practical changes without returning to another editor.

### 3.1 Content overlay editor

- Add and format text
- Add, resize, rotate, and position images
- Add links, shapes, lines, checkmarks, and freehand drawing
- Copy, paste, align, layer, and delete added objects
- Per-page undo and redo

The first release edits through overlays. Editing arbitrary existing PDF text
with full font and layout fidelity is explicitly deferred until it can be done
reliably.

### 3.2 Annotation

- Highlight, underline, and strike through selectable text
- Sticky notes and comments
- Drawing and shape annotations
- Author and timestamp metadata
- Flatten annotations into a final copy

### 3.3 Permanent redaction

- Draw redaction areas
- Search and mark matching text across pages
- Preview all marked regions
- Permanently remove underlying text and image content
- Optional metadata and embedded-file sanitization
- Verification pass confirming redacted text cannot be extracted or searched

### 3.4 AI-assisted editing and review

- Convert instructions such as “highlight every deadline” into reviewable annotations
- Find names, email addresses, account numbers, or user-described sensitive content
  and propose redactions
- Suggest clearer replacement text without changing the document until approved
- Create document-wide annotation summaries with page citations
- Require explicit review of semantic redaction candidates before permanent removal

### Exit criteria

- Added content appears in the same position in preview and download.
- Annotation data can be retained or flattened by user choice.
- Redaction removes underlying content rather than placing a visual rectangle over it.

## Phase 4 — Document conversion

**Purpose:** make InsightPDF useful beyond PDF-only input.

Version 1 already provides DOCX-to-PDF, PDF-to-DOCX, and DOCX-to-Markdown.
Version 2 expands format coverage, conversion controls, layout reconstruction,
batch conversion, and fidelity reporting.

### 4.1 Office and image to PDF

- Word to PDF: DOCX, with font substitution and fidelity warnings
- PowerPoint to PDF: PPTX
- Excel to PDF: XLSX with sheet and print-area selection
- JPG, PNG, TIFF, and WebP to PDF
- Plain text and Markdown to PDF

### 4.2 PDF export

- Improve PDF to DOCX reconstruction for headings, lists, tables, columns, and images
- PDF to XLSX/CSV for detected tabular data
- PDF to PPTX with one editable slide per detected page layout where feasible
- PDF to JPG, PNG, or WebP with DPI and page-range controls
- Searchable PDF output from scanned documents

### 4.3 Fidelity handling

- Preview converted output before download
- Identify scanned or complex-layout files that may reduce fidelity
- Preserve selectable text whenever possible
- Provide an OCR option for image-based source documents
- Show conversion warnings at page level

### AI assistance

- Recommend the best output format based on the user’s intended next action
- Detect whether OCR, table extraction, or layout preservation should be prioritized
- Explain likely fidelity limitations before conversion
- Route table-heavy, slide-like, scanned, and text-heavy documents through
  appropriate conversion strategies

### Exit criteria

- Every advertised format has tested sample documents and documented limitations.
- Conversion failures identify the affected file or page.
- Common business documents retain readable structure, images, and tables.
- Multi-file conversion is supported through the batch workflow.

## Phase 5 — Security, forms, and personal signing

**Purpose:** support completion and safe distribution of real documents.

### 5.1 PDF security

- Encrypt PDFs with an open password
- Optional permissions for printing, copying, and editing
- Unlock PDFs when the user supplies the valid password
- Remove document metadata
- Display encryption and permission status before processing
- Never store submitted passwords in logs or file history

### 5.2 Form filling

- Detect and render existing AcroForm fields
- Fill text fields, checkboxes, radio buttons, dropdowns, and date fields
- Save editable or flattened output
- Validate required fields before export
- Support keyboard navigation and accessible labels

### 5.3 Form creation

- Add text, checkbox, radio, dropdown, date, and signature fields
- Configure names, required state, default values, and tab order
- Preview the form as a recipient

### 5.4 Personal e-signatures

- Draw, type, or upload a signature and initials
- Place, resize, and reuse saved signatures
- Add signing date and signer name
- Flatten the signed result
- Record a basic local signing event in document history

Signature requests, identity verification, certificate-based digital
signatures, and jurisdiction-specific compliance are not part of the core
Version 2 release.

### 5.5 AI-assisted completion

- Suggest form values only from user-approved profile data or selected documents
- Extract candidate values with citations and confidence
- Never fill or sign a form without showing the proposed values
- Identify missing required fields and inconsistent entries
- Explain password and permission choices in plain language
- Treat signing, unlocking, permission changes, and sharing as confirmation-required actions

### Exit criteria

- Protected files open only with the configured password in standard PDF readers.
- Filled forms retain correct values after download and reopening.
- Flattened forms and signatures cannot be accidentally edited as form fields.
- Passwords and raw signature assets are handled as sensitive data.

## Phase 6 — Batch workflows, sharing, and continuity

**Purpose:** connect individual tools into repeatable user workflows.

### 6.1 Batch processing

- Select multiple files from upload or file history
- Run compression, conversion, watermarking, page numbering, protection, and OCR in batches
- Apply shared settings or customize per file
- Download successful outputs as a ZIP
- Retry failed files without rerunning successful files

### 6.2 Combined workflows

- Chain compatible operations, such as merge → compress → protect
- Preview the planned sequence before processing
- Save a workflow as a reusable preset
- Preserve intermediate outputs only when requested

### 6.3 Sharing

- Create expiring, revocable download links
- Optional link password
- Configurable download allowance
- Shared-file activity: created, viewed, downloaded, expired, and revoked
- No public indexing of shared documents

### 6.4 File continuity

- Favorite or pin files
- Duplicate an existing result as the starting point for a new operation
- Show relationships between original files and generated versions
- Restore recently deleted files during a short recovery window

### 6.5 AI workflow templates

- Turn a successful workflow into a named reusable automation
- Run a saved automation against newly selected files
- Allow variables such as recipient, target size, watermark, language, or date
- Summarize batch exceptions and recommend corrective actions
- Never silently broaden the selected files or recipients

### Exit criteria

- Partial batch failures never hide successful results.
- Workflow steps execute in the displayed order and expose step-level errors.
- Revoked or expired links stop working immediately.
- Users can trace every generated result to its source files and operations.

## Phase 7 — Unified product experience and release hardening

**Purpose:** ship Version 2 as one coherent product.

### Deliverables

- Tool-specific entry pages with examples, supported formats, limits, and privacy information
- Global “What do you want to do?” tool search
- Global AI command bar with examples based on the current file and available tools
- Clear distinction between proposed, approved, executing, verified, and failed states
- Human-readable automation history showing AI decisions and deterministic tool results
- Recommended next actions on result screens
- First-use guidance for editing, signing, and batch workflows
- Responsive layouts for all core workflows
- Keyboard-accessible editor and page organizer
- Cross-browser testing for file, editor, preview, and download flows
- Performance budgets for initial load, preview rendering, and large-file operations
- Recovery tests for worker restarts and interrupted operations
- Security review of file parsing, conversion services, share links, redaction, and encryption
- Updated product documentation, architecture notes, and automated acceptance tests

### Version 2 definition of done

Version 2 can be released when:

- All Phase 0–6 exit criteria pass.
- Representative natural-language requests produce correct plans across every tool category.
- Prompt-injected document content cannot alter tool authorization, confirmation, recipients,
  file selection, or security policy.
- AI plans remain advisory until validated and approved according to risk policy.
- Every tool works through upload, preview, processing, result, download, and history.
- Supported format and file-limit claims are verified by automated fixtures.
- Core workflows work on desktop and mobile-width layouts.
- Accessibility checks cover keyboard navigation, focus, labels, contrast, and error announcements.
- No operation silently modifies or deletes the original file.
- Security testing confirms user isolation, private storage, valid share-link authorization,
  permanent redaction, and safe password handling.
- Backup, recovery, retention, and deletion behavior are documented and tested.

## Recommended implementation order

| Order | Workstream | Depends on | User value |
|---|---|---|---|
| 1 | Tool registry, workflow engine, and file/result history | Version 1 jobs and storage | Safe foundation for AI and manual tools |
| 2 | AI planner, plan preview, confirmation, and verification | Tool registry | Natural-language automation |
| 3 | Compression and visual page organizer | Shared workflow | Highest-frequency PDF needs |
| 4 | Crop, page numbers, headers/footers, and repair | Organizer | Completes core PDF essentials |
| 5 | Office/image conversion and AI routing | Shared workflow and worker isolation | Expands beyond PDF-only input |
| 6 | Overlay editor and annotations | Stable preview coordinate system | Enables everyday PDF changes |
| 7 | Semantic review and permanent redaction | Editor selection and rendering | AI-assisted security-critical editing |
| 8 | Password protection and unlocking | Shared workflow | Safe document distribution |
| 9 | Form filling and personal signatures | Editor primitives | Completes common document tasks |
| 10 | AI-assisted form completion and form creation | Stable form filling | Advanced document preparation |
| 11 | Batch, saved automations, and combined workflows | Mature individual tools | Repeatable productivity |
| 12 | Share links and recovery | File history and security review | End-to-end delivery |
| 13 | AI safety, cost, and release hardening | All core features | Version 2 launch |

## Suggested delivery milestones

Milestones are outcome-based rather than date-based. Estimate dates only after
the conversion and editing engines have been prototyped, since those carry the
largest fidelity risk.

### Milestone A — Complete PDF toolkit

AI-ready Phase 0, the first document copilot, compression, visual page
organization, crop, page numbers, headers/footers, and repair. Users can ask
for supported single-file workflows in natural language.

### Milestone B — Convert and edit

Office/image conversion, PDF export, overlay editing, annotations, AI-assisted
review, and permanent redaction. The copilot can compose these tools into
reviewable workflows.

### Milestone C — Complete and secure

Password security, metadata removal, form filling, form creation, personal
signatures, and confirmation-controlled AI assistance.

### Milestone D — Product platform

Batch operations, saved AI automations, combined workflows, sharing, version
relationships, recovery, cost controls, and release hardening.

## Post-Version 2 expansion

These are valuable platform capabilities, but they should follow the complete
single-user Version 2 experience:

- Signature requests with recipients, reminders, audit trails, and compliance review
- Organization workspaces, roles, shared folders, and administrative policies
- Comments, review assignments, approvals, and real-time collaboration
- Subscription plans, metering, invoices, coupons, and billing administration
- Google Drive, OneDrive, Dropbox, and Box import/export
- Public API, webhooks, and automation integrations
- Native mobile scanning and offline capture
- Certificate-based digital signatures and long-term validation
- Advanced arbitrary existing-text editing
- Domain-specific AI workflows and reusable extraction templates
- Scheduled and event-triggered autonomous workflows with separately defined permissions

## Product measures

Track these once usage analytics are introduced:

- Percentage of users who successfully complete their first tool operation
- Processing success rate by tool and source format
- Median time from upload to downloadable result
- Natural-language plan acceptance rate
- Percentage of plans edited before approval
- Tool-selection and parameter-correction rate
- AI cost per completed workflow
- Deterministic verification failure rate after AI-planned execution
- Conversion fidelity issue rate
- Batch partial-failure rate
- Percentage of generated results downloaded or shared
- Repeat usage by tool category
- Redaction verification failure count
- Support requests per completed operation

These measures should guide prioritization. A smaller set of dependable tools is
more valuable than a large catalog with unpredictable output.
