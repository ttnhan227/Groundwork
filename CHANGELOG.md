# Changelog

All notable changes to **Groundwork** are documented in this file.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [2.0.0] - 2026-11-07

### Product Evolution — Intelligent Windows System Companion

- **Safe Operation Engine & Local Operation History (`SafeOperationEngine`, `PolicyEngine`, `OperationHistoryService`)**:
  - Implemented the 10-step Safe Operation lifecycle (Inspect → Validate prerequisites → Capture original state → Explain proposed change → Display risks/effects → Request approval via single-use time-bounded token → Execute → Verify resulting state → Record result → Provide one-click rollback).
- **Tool Registry & System-Aware Agent Planner (`ToolRegistryService`, `AgentPlannerService`)**:
  - Registered strongly typed read-only diagnostic tools and approval-gated modifying operation tools.
  - Enabled the AI Assistant to work both deterministically offline via local system tools and enhanced with multi-provider LLMs (`Ollama`, `Gemini`, `OpenAI`, `Anthropic`, `Mistral`, `Custom`).
- **Signature Feature — Groundwork Guided Investigations (`InvestigationEngineService`)**:
  - Added multi-tool guided investigations for *Performance*, *Storage*, *Network*, *Windows Health*, *Startup*, *Hardware*, and *Custom Symptoms*.
  - Strictly separates **Confirmed Observations** (live telemetry) from **Potential Contributing Factors** and **Unverified Hypotheses**, with Markdown/Text/JSON report export.
- **Optimize Module (`WindowsOptimizationService`)**:
  - Power Plan inspection, tradeoff explanation, verified switching (`powercfg`), and rollback.
  - Startup entry discovery across `HKCU`/`HKLM`/`WOW6432Node` `Run` keys and Startup folders with publisher verification, impact assessment, and reversible enable/disable.
  - Transparent Windows Performance, Gaming & Privacy settings inspection and reversible configuration.
- **Troubleshoot Module (`DiagnosticsAndTroubleshootingService`)**:
  - Network Troubleshooter (adapter IP/Gateway/DNS inspection, ICMP Ping, DNS lookup, well-known DNS provider guidance, and DNS cache flush).
  - Windows Event Log Investigator (`wevtutil` XML query of `System` and `Application` logs with plain-English explanations).
  - Core Windows Services & System Repair auditing (`Win32_Service`, CBS/Windows Update pending reboot flags, PnP Device Manager error codes, and `SFC`/`DISM` guidance).
- **Reversible File Organizer (`FileOrganizerService`) & DPAPI Credential Protection (`DpapiSecretProtector`)**:
  - Completed Smart File Organizer execution and one-click verified Undo.
  - Encrypted stored AI API keys at rest using Windows DPAPI (`crypt32.dll` `CryptProtectData`).

---

## [1.0.0] - 2026-10-26

### First Release

- Native WinUI 3 Windows desktop app with local-first storage scanning, system diagnostics, and a grounded AI assistant (Ollama, LM Studio, Gemini, OpenAI, Anthropic Claude, Mistral, Groq, DeepSeek, or OpenRouter). When a question needs web search and search is off, the agent says so instead of answering from memory.
- Structured system inventory context, cached locally with identifying serial, MAC, host, and user fields removed.
- Windows CPU, memory, GPU-engine, and disk-I/O measurements, restart indicators, and device error reporting.
- Safe cleanup: leftover inspection after uninstall, validated recursive-size proposals, and mandatory confirmation for permanent deletion.
- Windows installer with a version-specific filename and an update or uninstall choice when Groundwork is already installed.
- Portable ZIP and SHA-256 checksums published with each GitHub Release.
