# Groundwork — Privacy & Security Model

## 1. Local-First By Default

Groundwork is a **100% local-first** native Windows utility.
- All storage scanning, duplicate detection, hardware inspection, startup management, power configuration, network troubleshooting, event log analysis, and operation history run locally on your machine.
- Groundwork includes **zero telemetry, zero analytics SDKs, and zero background cloud synchronization**.
- Every tool and guided investigation functions without an internet connection or an AI account.

---

## 2. Optional AI Provider Data Boundaries

When you explicitly use the **AI Assistant** module:
- **Local Mode (`Ollama`)**: Prompts and system context are sent strictly to your configured local loopback endpoint (`http://localhost:11434` by default). No data leaves your device.
- **Cloud Providers (`Gemini`, `OpenAI`, `Anthropic`, `Mistral`, `Custom`)**:
  - Data is transmitted over HTTPS (`TLS 1.2+`) directly to the selected provider endpoint only when you submit a message in the AI Assistant.
  - Before assembling the system grounding prompt, `AgentSystemContextBuilder` automatically sanitizes user profile paths (replacing `C:\Users\<Username>` with `%USERPROFILE%`) so personal Windows account names are not leaked in file paths.
  - Raw file contents are **never** uploaded or indexed.

---

## 3. Credential Storage Security (Windows DPAPI)

- Cloud AI API keys configured in Groundwork Settings are encrypted at rest using **Windows Data Protection API (`System.Security.Cryptography.ProtectedData`)** scoped to `DataProtectionScope.CurrentUser`.
- On disk in `%APPDATA%\Groundwork\settings.json`, encrypted secrets are stored with a `dpapi:` prefix and cannot be decrypted by other Windows users or on other machines.
- Legacy plaintext keys (if present from an older configuration file) are transparently migrated to DPAPI-encrypted payloads upon save.
- API keys are never written to `AgentLocalStateService`, `OperationHistoryService`, exported investigation reports, or crash logs.

---

## 4. Safe System Execution Boundaries

1. **No Arbitrary Shell Execution**: Groundwork does not execute LLM-generated PowerShell or command-line strings. All tools in `ToolRegistryService` invoke strongly typed C# methods, Win32 APIs, or fixed executables with explicit `ProcessStartInfo.ArgumentList` arrays.
2. **Protected Path Guards**: `SafeCleanupService` and `FileOrganizerService` block modifications to `C:\Windows`, `System32`, `Program Files`, user profile roots, drive roots, and NTFS reparse points.
3. **Single-Use Approval Tokens**: Modifying operations require an explicit, time-bounded (5-minute TTL), single-use confirmation token generated after inspecting the target state.
4. **Standard User Default**: Groundwork runs as a standard user by default and explicitly checks `PolicyEngine.IsCurrentProcessElevated()` before attempting operations that require Administrator privileges.
