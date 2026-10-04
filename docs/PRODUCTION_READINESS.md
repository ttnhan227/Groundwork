# Groundwork readiness — 4 October 2026

Groundwork remains a working preview. No release was published during this repair. Passing automated checks is evidence for the covered workflows; final launch approval remains yours.

## Completed

- Account failures now offer retry instead of an endless loading heading. Search shortcuts cannot overlap onboarding or sign-in dialogs.
- AI providers reject empty answers. Gemini joins answer parts and excludes internal reasoning. Live Gemini generation passed with a synthetic prompt; user preferences were not changed.
- Packaging now uses clean, isolated build state after stale cached Python code was found during installer verification.
- Stable release publication requires a trusted Windows signature; preview builds remain available without a certificate.
- Backend suite: 74 passed. Onboarding/account recovery browser checks passed. Frozen-core checks passed for search, file changes, Git history, persistence, and provider errors. Scale checks covered 1,101 files and interrupted indexing.
- The rebuilt Windows installer passed silent installation, native startup, search, investigations, notes, restart/persistence, and live Cloud Run email login/metadata sync. This installer was used for verification and was not published.

## Requires your account, device, or decision

1. Finish a real Google sign-in from the installed app and confirm you return signed in. Automated signature/token tests cannot select your Google account for you.
2. On your computer, choose a folder in the native picker and use Ctrl+Space while another application has focus. The available automation cannot operate those native desktop controls.
3. Obtain a trusted Windows code-signing identity. A PFX identity can use the documented GitHub signing secrets; hardware/managed identities require the chosen provider's integration. The signed branch cannot be fully exercised before an identity exists.
4. Confirm your production database backup retention, restore procedure, and alert destination in your hosting accounts.
5. Accept the everyday UX, then explicitly request a release. No version tag or public installer publication is part of this repair.

OpenAI and Ollama live checks require an appropriate key or a running local model. The Gemini provider was verified; this does not certify every optional provider or every possible prompt.
