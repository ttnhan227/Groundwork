# InsightPDF Version 3 Product Roadmap

## Updated release focus — Business Document Operations

Version 3 changes InsightPDF from a primarily individual document toolkit into
a system that a real team can use inside an operational process.

The release is intentionally centered on one repeatable loop:

> Receive documents, classify them, extract business data, review the evidence,
> approve the result, and send the approved information to another system.

The initial target is small operations, procurement, legal, HR, and compliance
teams that repeatedly review contracts, policies, onboarding files, invoices,
and supporting records.

InsightPDF will not attempt to replace SharePoint, Box, a CRM, an accounting
system, or a contract lifecycle management platform. It will provide the
intelligence and review layer between incoming documents and those systems.

## Primary product outcome

A team should be able to configure a document process once and then reuse it:

```text
Email, upload, API, or connected drive
                    |
                    v
        Classify and validate document
                    |
                    v
     Extract structured business fields
                    |
                    v
       Show page-level source evidence
                    |
                    v
       Human reviews and corrects data
                    |
                    v
        Approval rules are evaluated
                    |
                    v
 Export, notify, archive, or call webhook
                    |
                    v
      Searchable record and audit history
```

## Version 3 committed scope

1. Organization workspaces with membership and role-based permissions
2. Shared document libraries, folders, ownership, and assignments
3. Reusable structured-extraction templates
4. Evidence, confidence, validation, and human correction for every field
5. Review queues and configurable approval steps
6. Trigger, condition, and action automation rules
7. Email ingestion, CSV/JSON export, notifications, webhooks, and one drive connector
8. Complete audit history for documents, fields, reviews, approvals, and exports
9. Organization-level usage controls, retention policies, and administrative reporting
10. Reliability, security, evaluation, monitoring, and recovery appropriate for business trials

## Explicitly deferred

Version 3 will not initially include:

- Real-time collaborative document editing
- A full CRM, accounting product, or contract lifecycle management suite
- Legally compliant signature-request workflows
- Autonomous approval of high-risk business decisions
- Unreviewed AI writes into external systems
- Custom model training for every customer
- Native mobile applications
- On-premises installation
- Enterprise certification claims
- A marketplace containing hundreds of integrations

The first release should prove that one document workflow saves measurable time
and produces trustworthy data.

# Product Positioning

## Recommended initial workflow

The first packaged workflow should be **contract and policy review for small
teams**.

Example supported documents:

- Vendor agreements
- Statements of work
- Employment policies
- Service agreements
- Data-processing agreements
- Lease agreements
- Internal compliance policies

Example extracted fields:

- Document type
- Parties
- Effective date
- Expiration date
- Renewal terms
- Termination notice period
- Total contract value
- Payment terms
- Governing law
- Liability cap
- Confidentiality clause
- Data-processing obligations
- Named owner
- Important deadlines
- Missing required clauses
- Review status
- Risk flags

The same platform must remain general enough to support invoices, onboarding,
insurance, and compliance workflows later without changing the underlying data
model.

## Product promise

InsightPDF should promise:

> Turn incoming business documents into reviewed, traceable, actionable records.

It should not promise:

> AI will make legal, financial, compliance, or employment decisions for you.

AI suggestions remain reviewable. High-risk actions require explicit human
approval.

# Core Domain Model

Add or formalize the following concepts.

## Organizations

An organization contains:

- ID
- Name
- Slug
- Plan
- Status
- Default retention policy
- AI and storage limits
- Created and updated timestamps

Every business resource must belong to an organization. Personal accounts may
use a private organization containing one member so the data model stays
consistent.

## Memberships

A membership contains:

- User ID
- Organization ID
- Role
- Status
- Invited by
- Invitation and acceptance timestamps

Initial roles:

- Owner
- Admin
- Manager
- Reviewer
- Member
- Viewer

Permissions must be checked in backend services and queries. Hiding a frontend
button is not authorization.

## Libraries and folders

Organizations can create libraries and folders for departments, customers,
vendors, projects, or document processes.

Each library should define:

- Members and groups with access
- Default extraction template
- Default workflow
- Retention policy
- Allowed document types
- External integration destination

## Business records

A document may produce one or more business records. A record represents the
reviewed operational data extracted from the file.

Examples:

- A contract record
- An invoice record
- An employee-onboarding record
- A policy record

Records should remain linked to:

- Original document
- Generated versions
- Extraction run
- Template version
- Source evidence
- Human corrections
- Review and approval history
- Export destinations

## Template versions

Changing a template must create a new immutable version. Existing extraction
results must retain the exact template definition and prompt version used when
they were produced.

## Audit events

Important activity should append an immutable audit event:

- Document uploaded, replaced, moved, or deleted
- Processing started, retried, failed, or completed
- Field extracted, corrected, accepted, or rejected
- Review assigned or completed
- Approval requested, approved, or rejected
- Rule created, changed, enabled, or disabled
- Export or webhook attempted
- Member invited, removed, or given a new role
- Retention or security setting changed

# Phase 0 — Customer Discovery and Workflow Definition

**Purpose:** avoid building a generic enterprise platform without a proven
business process.

## 0.1 Design-partner interviews

Interview at least five people who process similar documents.

For each interview, record:

- Which documents arrive repeatedly
- How documents arrive
- Which fields are copied manually
- Which decisions follow extraction
- Who reviews the result
- Which errors are expensive
- Where approved data is stored
- Monthly document volume
- Current time per document
- Current software and integration constraints

Do not ask only whether the product idea sounds useful. Observe or reconstruct
the current process step by step.

## 0.2 Workflow selection

Select the first workflow using:

- Frequency
- Manual time
- Error cost
- Similarity across customers
- Availability of representative documents
- Willingness to run a trial
- Integration complexity
- Regulatory risk

## 0.3 Baseline measurement

Before automation, measure:

- Median handling time per document
- Percentage requiring rework
- Fields commonly missed
- Time waiting for approval
- Number of systems updated manually

These values form the business case and later product metrics.

### Exit criteria

- One target workflow and buyer are written in one sentence.
- At least three design partners confirm the same repeated pain.
- Representative redacted sample documents are available.
- Required fields, validation rules, reviewers, and destinations are documented.
- A baseline exists against which the product can demonstrate improvement.

# Phase 1 — Organization and Permission Foundation

**Purpose:** make InsightPDF safe and understandable for a team rather than one
individual account.

## 1.1 Organization workspaces

- Create and switch organizations
- Invite members by email
- Accept, expire, revoke, and resend invitations
- Change roles
- Remove and deactivate members
- Transfer organization ownership
- Prevent removal of the final owner

## 1.2 Shared document libraries

- Shared folders and libraries
- Library-level membership
- Document owner and assigned reviewer
- Search by filename, extracted field, status, owner, and date
- Saved views for common queues
- Favorites and recent documents

## 1.3 Authorization

Create a centralized permission service covering:

- View document and extracted text
- Download originals and generated files
- Run AI and deterministic tools
- Correct extracted values
- Complete reviews
- Approve records
- Manage templates and rules
- Export data
- Manage members and organization settings

Every database query that returns organization data must scope by organization
and membership.

## 1.4 Administrative controls

- Organization usage dashboard
- Per-member and organization AI limits
- Storage limits
- Upload limits
- Allowed file types
- Retention settings
- Enable or disable AI features by organization
- Enable features for selected roles

### Exit criteria

- Two organizations cannot access each other's files, records, results, or audit events.
- A removed member immediately loses access.
- Permissions are enforced by backend tests for every protected resource.
- Shared libraries show consistent results to authorized members.
- Organization owners can see usage without accessing hidden secrets.

# Phase 2 — Structured Extraction Templates

**Purpose:** turn unstructured files into reusable business records.

## 2.1 Template builder

Allow authorized users to create templates containing:

- Template name and description
- Applicable document types
- Field name and business label
- Field data type
- Required or optional status
- Extraction instructions
- Validation rules
- Allowed values
- Repeatable table or list fields
- Risk level
- Reviewer guidance

Initial field types:

- Short text
- Long text
- Number
- Currency
- Percentage
- Date
- Boolean
- Choice
- Person or organization
- Address
- List
- Table

## 2.2 Template presets

Ship tested presets for:

- Contract review
- Policy review
- Invoice intake
- Employee onboarding checklist

Presets are starting points and can be duplicated. They must state their
limitations and must not be described as legal or financial advice.

## 2.3 Extraction execution

The extraction pipeline should:

1. Validate document access and readiness
2. Select a template version
3. Use deterministic parsing where reliable
4. Retrieve relevant pages or regions
5. Request schema-constrained AI output
6. Validate types and formats
7. Link every value to supporting evidence
8. Mark unsupported or absent values as not found
9. Persist model, prompt, template, and processing versions
10. Send the result to review

## 2.4 Evidence and confidence

Every extracted field must include:

- Proposed value
- Source document
- Page number
- Supporting text or visual region
- Extraction method
- Confidence band
- Validation warnings
- Review state

Users must be able to open the source page directly from a field.

Confidence must not be presented as a mathematical guarantee. Use understandable
bands such as high, medium, low, and needs review.

## 2.5 Validation

Support:

- Required fields
- Date and number formats
- Minimum and maximum values
- Allowed choices
- Cross-field rules
- Duplicate detection
- Deadline calculation
- Customer-specific instructions

Validation failures must not silently discard the AI result.

### Exit criteria

- An administrator can create and version a template without code changes.
- Extraction produces schema-valid data or explicit field-level failures.
- Every accepted value has traceable evidence.
- Missing information is reported as missing instead of invented.
- Template changes do not alter historical results.
- Corrections are retained for evaluation and audit.

# Phase 3 — Human Review and Approval

**Purpose:** make AI output trustworthy enough to enter a business process.

## 3.1 Review queue

Provide queues for:

- Unassigned
- Assigned to me
- Needs review
- Validation failed
- Awaiting approval
- Approved
- Rejected
- Export failed

Filters should include library, template, document type, risk, due date, owner,
reviewer, and status.

## 3.2 Review interface

Display:

- Document preview
- Extracted fields
- Evidence for the selected field
- Confidence and validation warnings
- Prior value and correction history
- Comments
- Related documents and versions

Reviewers can:

- Accept
- Edit
- Reject
- Mark not applicable
- Request another review
- Add evidence
- Assign another reviewer

## 3.3 Approval policies

Support policies such as:

- One reviewer approval
- Manager approval above a monetary threshold
- Legal approval when selected clauses are missing
- Two approvals for high-risk records
- Re-review when the source document changes

Approval policies must be deterministic. AI may recommend escalation but cannot
bypass the configured policy.

## 3.4 Notifications

Notify users when:

- Work is assigned
- A due date approaches
- A review is returned
- Approval is requested
- An export fails
- A workflow remains blocked

Initial delivery can use in-app and email notifications.

### Exit criteria

- No high-risk record can be exported before its approval requirements pass.
- Every field correction records who changed it, when, and why.
- Replacing a source document invalidates affected approvals.
- Reviewers can complete the workflow without switching between unrelated screens.
- Queue counts and record status remain consistent during retries and concurrent work.

# Phase 4 — Rules and Workflow Automation

**Purpose:** convert approved document intelligence into repeatable actions.

## 4.1 Rule model

A rule contains:

- Name
- Organization and library
- Trigger
- Conditions
- Ordered actions
- Enabled state
- Owner
- Version
- Failure policy
- Last execution

## 4.2 Triggers

Initial triggers:

- Document uploaded
- Document classified
- Extraction completed
- Validation failed
- Review completed
- Record approved
- Deadline approaching
- Export failed

## 4.3 Conditions

Conditions may inspect:

- Document type
- Extracted field value
- Missing field
- Confidence band
- Validation result
- Risk flag
- Library or folder
- File source
- Reviewer or owner
- Date and deadline

## 4.4 Actions

Initial actions:

- Apply template
- Assign reviewer
- Request approval
- Set record value
- Move document
- Add tag
- Send email notification
- Send Slack or Teams notification
- Generate CSV or JSON
- Call webhook
- Create follow-up task

Destructive or external-write actions require an appropriate permission and,
where configured, explicit approval.

## 4.5 Rule builder

Provide:

- Visual trigger, condition, and action editor
- Plain-language summary
- Test mode using a selected document
- Preview of matched documents
- Validation before activation
- Execution history
- Pause and resume
- Duplicate and version

AI can translate natural-language intent into a proposed rule, but the user must
review the exact trigger, conditions, actions, and affected scope before enabling it.

## 4.6 Reliability

- Idempotency keys for every action
- Safe retries for temporary failures
- Dead-letter state for exhausted retries
- No duplicate exports or notifications
- Step-level timestamps and errors
- Manual replay from a failed step
- Concurrency controls for the same record

### Exit criteria

- Equivalent events do not create duplicate external actions.
- Users can test a rule without modifying production data.
- Every execution shows which conditions matched and which actions ran.
- Failed actions can be retried without repeating successful actions.
- AI-generated rules cannot exceed the creator's permissions.

# Phase 5 — Ingestion and Integrations

**Purpose:** meet documents where the business already receives and stores them.

## 5.1 Email ingestion

- Unique ingestion address per organization or library
- Sender allowlist
- Attachment validation
- Duplicate detection
- Original message metadata
- Clear handling of unsupported or encrypted attachments
- Quarantine for suspicious input

## 5.2 Public API

Provide versioned API endpoints for:

- Uploading documents
- Checking processing status
- Retrieving approved records
- Starting extraction
- Listing templates
- Receiving export results

API keys must be:

- Organization-scoped
- Hashed at rest
- Shown only once
- Named
- Permission-scoped
- Revocable
- Rotatable
- Audited

## 5.3 Webhooks

Support events such as:

- Document ready
- Extraction completed
- Review required
- Record approved
- Record rejected
- Export failed

Requirements:

- Signed payloads
- Timestamp and replay protection
- Configurable secret rotation
- Delivery history
- Exponential retry
- Manual resend

## 5.4 Export

Initial export destinations:

- CSV
- JSON
- Downloadable ZIP containing source, record, and report
- Webhook

Each export must include stable identifiers and schema/template version.

## 5.5 First connected drive

Implement one of Google Drive, OneDrive/SharePoint, or Box based on design-partner
demand.

The connector should support:

- Import from selected folders
- Optional continuous ingestion
- Preserve source identifier and URL
- Avoid duplicate processing
- Export approved result or metadata
- Revoked-authorization handling
- Least-privilege permissions

Do not build multiple shallow connectors before one is reliable.

### Exit criteria

- Documents can enter InsightPDF without manual browser upload.
- Approved structured data can leave without manual copying.
- Webhook authenticity can be independently verified.
- Revoking a key or connector immediately prevents new access.
- Duplicate source events do not produce duplicate records.

# Phase 6 — Search, Reporting, and Operational Visibility

**Purpose:** make processed documents useful after the initial workflow completes.

## 6.1 Business search

Search across:

- Filename
- Full text
- Extracted fields
- Tags
- Organization and counterparty
- Dates and deadlines
- Status
- Owner and reviewer
- Template
- Risk flags

Search results must respect permissions before ranking or summarization.

## 6.2 Saved views

Examples:

- Contracts expiring in 90 days
- Records missing an owner
- High-value agreements awaiting approval
- Policies not reviewed this year
- Failed exports
- Low-confidence extractions

## 6.3 Dashboards

Operational metrics:

- Documents received
- Processing success rate
- Median processing time
- Review backlog
- Median review time
- Approval time
- Automation success rate
- Extraction correction rate
- Cost per completed record
- Deadlines approaching

Dashboards should link to the underlying records rather than showing decorative charts.

## 6.4 Reports

- Scheduled CSV reports
- Workflow performance report
- Extraction-quality report
- Usage and cost report
- Audit export

### Exit criteria

- Search never reveals unauthorized metadata or snippets.
- Dashboard values reconcile with underlying records.
- Saved views can power queues and reports.
- Administrators can identify failing workflows and high-cost usage.

# Phase 7 — Security, Governance, and Reliability

**Purpose:** make controlled business trials safe and supportable.

## 7.1 File security

- File signature and MIME validation
- Malware scanning before processing
- Archive expansion limits
- Protection against decompression bombs
- Sandboxed conversion processes
- Encrypted-file handling
- Safe filenames and object keys
- Temporary-file cleanup

## 7.2 Data governance

- Configurable retention by organization and library
- Soft deletion with recovery period
- Permanent deletion jobs
- Legal-hold placeholder only if correctly implemented
- Data export for organization owners
- Clear provider data-flow documentation
- Configurable exclusion of selected libraries from AI processing

Do not claim legal compliance or certifications without completing the required
technical, procedural, and independent review work.

## 7.3 Authentication and sessions

- Email verification
- Password reset
- Session list and revocation
- Optional multi-factor authentication
- Login and invitation abuse prevention
- Organization-level SSO deferred until customer demand justifies it

## 7.4 Secrets and integrations

- Centralized secret storage
- No integration tokens in logs
- Encryption for stored connector credentials
- Key rotation procedures
- Separate development, staging, and production credentials

## 7.5 Observability

- Structured logs with request, organization, job, workflow, and trace IDs
- Error monitoring
- Queue depth and worker health
- Processing latency
- Provider latency and errors
- Token and cost reporting
- Webhook delivery metrics
- Alerts for unusual usage and repeated failures

## 7.6 Backup and recovery

- Automated database backups
- Object-storage durability policy
- Documented restoration procedure
- Periodic restoration test
- Worker restart and interrupted-job recovery test
- Migration rollback or forward-recovery plan

## 7.7 Abuse and cost controls

- Per-user and organization AI budgets
- Global provider budget
- Token-aware accounting
- Upload, OCR, conversion, and extraction limits
- Endpoint-specific rate limits
- Concurrency limits
- Emergency AI kill switch
- Admin ability to suspend accounts and organizations

### Exit criteria

- Security tests confirm organization and document isolation.
- Malware or invalid archives never reach conversion workers.
- Production secrets are separated and rotatable.
- A backup can be restored in a documented test.
- Operators can detect a stuck queue, provider outage, or cost spike.
- AI can be disabled without disabling deterministic document access.

# Phase 8 — Evaluation and Quality System

**Purpose:** measure whether extraction and AI assistance are reliable enough for
the selected workflow.

## 8.1 Evaluation dataset

Create a versioned dataset containing:

- Representative redacted documents
- Expected document classifications
- Expected field values
- Source page evidence
- Accepted variations
- Missing-field cases
- Scanned and image-heavy cases
- Adversarial and prompt-injection cases

## 8.2 Quality metrics

Measure:

- Classification accuracy
- Field precision and recall
- Exact and normalized value match
- Evidence-page accuracy
- Missing-value accuracy
- Human correction rate
- False risk-flag rate
- Processing failure rate
- Cost and latency per document

## 8.3 Regression testing

Run evaluations when changing:

- Model
- Prompt
- Template instructions
- OCR engine
- Chunking or retrieval
- Conversion pipeline
- Validation logic

A lower-cost model may be promoted only when it meets the required quality
threshold on the workflow dataset.

## 8.4 Feedback loop

Human corrections should produce reviewable evaluation candidates.

Do not automatically train or modify production prompts using customer
corrections. Curate, anonymize where required, approve, and version evaluation
examples first.

### Exit criteria

- The selected workflow has documented quality thresholds.
- Model or prompt changes cannot deploy without regression results.
- Accuracy is measured per field and document type rather than one misleading score.
- Human corrections are traceable and can improve future evaluations.

# Phase 9 — Commercial Trial Readiness

**Purpose:** support real design partners without pretending the product is a
finished enterprise platform.

## 9.1 Onboarding

- Guided organization setup
- Template selection
- Sample extraction
- Member invitation
- Workflow activation checklist
- Integration test
- Clear usage limits and support contact

## 9.2 Plans and metering

Initial trial plans can meter:

- Documents or pages processed
- AI extraction runs
- Storage
- Members
- Workflow executions
- Connector usage

Avoid complex billing until trials prove which unit aligns with customer value.

## 9.3 Support operations

- Organization diagnostic page
- Safe job replay
- Audit-friendly support access
- Customer-visible status messages
- Incident runbook
- Provider outage fallback behavior

## 9.4 Trial reporting

At the end of a trial, report:

- Documents processed
- Estimated manual time saved
- Correction rate
- Review turnaround
- Automation success
- Errors and unresolved limitations
- Estimated cost per processed document

### Exit criteria

- A design partner can onboard without developer database edits.
- Usage can be limited and attributed to an organization.
- Support can diagnose failures without viewing document content unnecessarily.
- Trial results demonstrate measurable time or error reduction.
- Product limitations are clearly communicated.

# Frontend Experience

## Main navigation

Recommended top-level areas:

- Inbox
- Documents
- Review
- Records
- Workflows
- Reports
- Organization settings

PDF tools remain available from a document's action menu but no longer dominate
the product navigation.

## Inbox

Show:

- Newly received documents
- Source
- Classification
- Processing state
- Assigned workflow
- Exceptions requiring attention

## Review

Use a split interface:

```text
+---------------------------+-----------------------------+
| Document preview          | Extracted record            |
|                           |                             |
| Highlighted evidence      | Field, value, confidence    |
| Page navigation           | Validation and actions      |
| Related documents         | Comments and approval       |
+---------------------------+-----------------------------+
```

Selecting a field should navigate to and highlight its evidence.

## Records

Provide a table-oriented business view rather than only document cards.

Users should be able to:

- Select columns
- Filter and sort
- Save views
- Open the source document
- View review history
- Export approved records

## Workflows

Show:

- Active rules
- Recent executions
- Failure queue
- Test mode
- Version history
- Usage and cost

## Accessibility

- Complete keyboard navigation
- Visible focus
- Correct dialog focus trapping and restoration
- Accessible field errors
- Screen-reader labels
- Non-color status indicators
- Reduced-motion support
- Automated checks plus manual keyboard testing

# API and Service Architecture

Continue using a modular monolith unless scale or isolation provides a measured
reason to extract services.

Recommended module boundaries:

```text
app/
├── organizations/
├── memberships/
├── libraries/
├── documents/
├── records/
├── templates/
├── extraction/
├── reviews/
├── approvals/
├── workflows/
├── integrations/
├── audit/
├── usage/
├── notifications/
├── storage/
├── jobs/
├── security/
└── observability/
```

Business logic should live in application services, not route handlers or
Celery task functions.

Use an outbox pattern for reliable events and external deliveries:

```text
Database transaction
    ├── update business record
    └── append outbox event
                 |
                 v
          background dispatcher
                 |
                 v
      email, webhook, or connector
```

# Testing Strategy

## Backend tests

Include:

- Organization isolation
- Role and permission matrix
- Invitation lifecycle
- Template versioning
- Schema validation
- Evidence ownership
- Human correction history
- Approval enforcement
- Rule matching
- Idempotent workflow execution
- Webhook signatures and retries
- Connector revocation
- Retention and deletion
- Usage limits
- Audit completeness

## Frontend tests

Include:

- Organization switching
- Review queue filtering
- Field correction
- Evidence navigation
- Approval actions
- Rule builder validation
- Permission-dependent controls
- Failure and retry states
- Keyboard navigation

## End-to-end tests

Required flows:

1. Create organization and invite reviewer
2. Upload or ingest a contract
3. Classify and extract fields
4. Correct a low-confidence value
5. Complete review
6. Request and grant approval
7. Export the approved record
8. Verify audit history
9. Reject unauthorized cross-organization access
10. Recover a failed workflow action

Paid AI tests should use controlled fixtures, recorded provider responses where
appropriate, and a small scheduled live evaluation.

# Version 3 Definition of Done

Version 3 is complete when:

- One target business workflow works from ingestion through approved export.
- Organizations, memberships, roles, and libraries are enforced by backend authorization.
- Extraction templates are reusable, versioned, and schema validated.
- Every extracted value is accepted, corrected, rejected, or explicitly not found.
- Every accepted AI value has page-level evidence.
- Review and approval policies cannot be bypassed by AI or frontend manipulation.
- Rules are testable, versioned, idempotent, and auditable.
- At least one non-browser ingestion path works.
- At least one external data destination works.
- Search and reports respect permissions.
- Usage, cost, errors, queues, and integrations are observable.
- Backups and restoration are tested.
- The target workflow has a regression evaluation dataset.
- A design partner completes a real trial and measurable workflow results are available.

# Recommended Implementation Order

| Order | Workstream | Depends on | Business value |
|---|---|---|---|
| 1 | Customer discovery and workflow definition | Existing V2 product | Prevents unfocused development |
| 2 | Organizations, memberships, and permissions | Current user model | Enables team use |
| 3 | Shared libraries and assignments | Organization foundation | Creates operational ownership |
| 4 | Template and record data model | Document pipeline | Turns files into structured data |
| 5 | Extraction with evidence and validation | Templates and current AI pipeline | Automates manual reading |
| 6 | Human review queue | Records and evidence | Makes AI output trustworthy |
| 7 | Approval policies and audit events | Review workflow | Supports controlled decisions |
| 8 | Rule engine and outbox | Stable record lifecycle | Automates repeatable actions |
| 9 | Email ingestion and webhooks | Rules and security | Connects existing systems |
| 10 | Search, saved views, and reports | Reviewed records | Creates ongoing operational value |
| 11 | Governance, monitoring, and recovery | All core workflows | Supports business trials |
| 12 | Evaluation system | Representative workflow data | Controls quality and model changes |
| 13 | Trial onboarding and metering | Stable platform | Validates commercial value |

# Suggested Delivery Milestones

Milestones are outcome-based. Do not assign dates until design-partner interviews
and the organization/permission migration have been prototyped.

## Milestone A — Team workspace

Organizations, invitations, roles, shared libraries, assignments, and audit
events. A small team can securely work from the same document library.

## Milestone B — Document to reviewed record

Template builder, contract preset, structured extraction, evidence, confidence,
validation, review queue, and corrections. A document becomes trustworthy
structured data.

## Milestone C — Approved business workflow

Approval policies, rules, notifications, idempotent execution, and failure
recovery. The reviewed record can safely trigger action.

## Milestone D — Connected operations

Email ingestion, public API, webhooks, one connected drive, exports, business
search, saved views, and reports.

## Milestone E — Design-partner release

Security hardening, monitoring, backups, evaluation dataset, onboarding,
metering, support runbooks, and a measured customer trial.

# Product Measures

## Customer value

- Median manual time saved per document
- Percentage of documents completed without rework
- Review turnaround time
- Approval turnaround time
- Number of manual system updates eliminated
- Percentage of approved records successfully exported
- Weekly active reviewers
- Repeat workflow usage

## Quality

- Field correction rate
- Evidence accuracy
- Missing-value accuracy
- Low-confidence rate
- False risk-flag rate
- Extraction failure rate
- Classification accuracy
- Accuracy by template field and document type

## Reliability

- Processing success rate
- Median and p95 processing time
- Queue age
- Workflow action success rate
- Duplicate external-action count
- Webhook delivery success rate
- Recovery time after worker interruption

## Economics

- AI cost per document
- Total processing cost per completed record
- Cost by organization and workflow
- Cache effectiveness
- Percentage of work completed deterministically
- Gross margin estimate by proposed plan

# Post-Version 3 Expansion

Consider these only after one workflow demonstrates recurring use:

- Additional industry-specific template packs
- Google Drive, OneDrive, SharePoint, Box, and Dropbox connectors
- Salesforce, HubSpot, QuickBooks, Xero, and DocuSign integrations
- Group-based access and enterprise SSO
- Customer-managed encryption keys
- Regional storage choices
- Advanced data-loss prevention
- API-based bulk migration
- Mobile capture and scanning
- Customer-configurable portals
- Cross-document portfolio analysis
- Renewal and obligation management
- Signature-request workflows after legal and security review
- Private or customer-selected model routing
- On-premises or private-cloud deployment where commercially justified

# Final Product Principle

Version 1 demonstrated document intelligence.

Version 2 unified document preparation, AI assistance, and reusable tools.

Version 3 must prove that InsightPDF can participate in a real business process.

The deciding question for every Version 3 feature is:

> Does this help a team move a document from arrival to a reviewed, approved,
> traceable business outcome?

If the answer is no, the feature should not be part of the initial Version 3
release.
