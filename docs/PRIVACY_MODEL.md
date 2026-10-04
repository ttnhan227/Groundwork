# Privacy model

Workspace discovery, parsing, indexing, FTS, local feature vectors, notes, sessions, and Git inspection run on the user's machine. Local indexing does not upload files when a remote generation provider is selected. Desktop fonts are bundled.

Groundwork Sync is optional. It transfers user-written note titles/content/tags, saved queries/filters, and permitted preferences. Notes may contain sensitive information that the user writes into them. Workspace paths attached to notes, source trees, indexed chunks, embeddings, and provider credentials are excluded from sync payloads.

Cloud AI is a separate opt-in operation. Choosing OpenAI or Gemini and running a query sends the question, retrieved snippets, and cited file paths to that provider. Ollama endpoints are restricted to loopback. Local mode displays retrieved excerpts without a network request or language-model inference.

The packaged local API uses a random per-launch bearer token on a dynamically selected loopback port. It rejects unknown browser origins and hosts. Native release startup does not attach to an arbitrary existing listener. Browser development uses an explicitly local development server.

Provider keys and cloud tokens are protected with Windows DPAPI in a separate private preferences file. They are not placed in the sync database or returned by the public preferences API. Development on other platforms uses environment configuration.

Cloud accounts use uniquely salted PBKDF2 password hashes. Existing legacy hashes are upgraded after successful login. Production rejects the development JWT secret. Sync receipts make acknowledged retries idempotent. Deletion tombstones propagate removals, and note revisions reject conflicting updates from current clients. Pending local changes survive offline failures and missing acknowledgements.

Registered roots define file access boundaries. AI tools cannot use a shell; approved commands are parsed into arguments and constrained to the allowlist. Test commands execute project code and still require explicit confirmation. Confirmations expire after five minutes, are single-use, and are bound to the exact proposed arguments.
