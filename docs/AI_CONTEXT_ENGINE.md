# AI context engine

The engine retrieves bounded local file evidence, optionally adds related Git history, and sends that context to the explicitly selected provider. Citations contain actual retrieved paths and excerpt line ranges. They identify the evidence provided to the model; generated prose is not automatically fact-checked.

Local mode is an extractive evidence viewer, not a local language model. It shows a clear missing-evidence response instead of treating prompt instructions as evidence. Ollama supplies optional on-device generation. OpenAI and Gemini supply optional remote generation. Provider failures are returned as errors rather than silently relabeling an offline answer as a cloud response.

Investigations store full findings, inspected files, and related commit hashes in context sessions. Resume includes the saved findings, notes, and unfinished work in the next query. Search-to-AI carries the selected absolute path and line; a validated current file read makes that selection the first source.

Tools expose JSON schemas and validate required fields, allowed fields, and argument types. Read operations are bounded to registered, eligible workspace files. Mutating AI tools require an expiring confirmation token. The token authorizes only the exact action and arguments that were proposed. Commands run without shell interpolation. Git commands are restricted to inspection; tests require confirmation because they execute workspace code.

The engine follows a deterministic bounded tool plan: search up to six files, validate and read at most forty lines from each, add project facts, optionally restore a context session, and inspect up to three related or recent Git commits. Each file excerpt is limited to 8,000 characters, project facts to 6,000, and saved context to 12,000. These same validated tools serve investigations and direct questions. Generation receives this bounded evidence and has no direct database or operating-system access. Symbol extraction outside Python remains limited; packaged MiniLM retrieval is trained, while the development hashing fallback is not.
