# AGENTS.md — Groundwork Engineering & Agent Architecture Guide

## 1. Product Identity & Vision

**Groundwork** is a native Windows System Management, Diagnostics, Optimization, Troubleshooting, and Maintenance Toolkit built with **C#, .NET 10, and WinUI 3 (Windows App SDK)**.

**Core Promise:** *Understand your PC. Investigate problems. Optimize with confidence. Maintain control.*

Groundwork operates in two equally first-class modes:
1. **Direct Native Utilities**: Users can directly inspect storage, hardware, processes, startup entries, power plans, network state, event logs, services, installed applications, and maintenance tasks without ever needing to configure or talk to an AI provider.
2. **System-Aware Agent & Guided Investigations**: Users can describe symptoms in natural language (e.g., *"My computer feels slower than usual"*, *"Why is my C drive almost full?"*, *"My internet keeps disconnecting"*) or launch structured **Groundwork Investigations**. The system inspects real Windows telemetry through registered, strongly typed tools, separates confirmed observations from potential contributing factors and unverified hypotheses, and gates any system modification behind the **Safe Operation Engine**.

---

## 2. Core Engineering Principles

1. **Practical Usefulness Over Feature Quantity**: Every module must inspect real Windows state and solve real problems.
2. **Evidence Over Assumptions**: Never claim a PC is healthy or unhealthy without concrete telemetry. Never fabricate unavailable hardware sensors (e.g., if CPU temperature is not exposed without a kernel driver, report `N/A` and explain why).
3. **Transparency Over Unexplained Automation**: Explain what every setting or cleanup action changes, why it matters, and what risks exist.
4. **User Control & Safety First**:
   - No unrestricted arbitrary shell or PowerShell execution by the AI agent.
   - All modifying actions must pass through the **10-Step Safe Operation Lifecycle**:
     1. Inspect current state
     2. Validate prerequisites
     3. Capture original state (where reversible)
     4. Explain proposed change
     5. Display potential risks & effects
     6. Request explicit user approval (single-use, time-bounded token)
     7. Execute operation
     8. Verify actual resulting system state
     9. Record result in `OperationHistoryService`
     10. Provide recovery / rollback where supported
5. **Local-First Processing & Privacy**:
   - All diagnostics, storage scanning, duplicate detection, startup management, and history ledgers remain 100% local on the user's machine.
   - AI providers are strictly optional (`Ollama` local, or cloud providers `Gemini`, `OpenAI`, `Anthropic`, `Mistral`, `Custom`).
   - API keys are encrypted at rest using Windows DPAPI (`ProtectedData` with `DataProtectionScope.CurrentUser`).
6. **Product Independence**:
   - External products may be used as internal research and feature references, but must never become part of Groundwork's public-facing identity or documentation.

---

## 3. Repository Structure

```text
Groundwork/
├── AGENTS.md                        # Engineering principles, agent architecture, and contributor guide
├── README.md                        # Product overview, capabilities, and build/test instructions
├── CHANGELOG.md                     # Version history and evolution log
├── docs/
│   ├── PRODUCT_SPECIFICATION.md     # Updated product specification & module breakdown
│   ├── ARCHITECTURE.md              # Engine, Safe Operation Framework, Agent & UI architecture
│   ├── PRIVACY_MODEL.md             # Local-first data boundaries, DPAPI credential storage, AI redaction
│   └── SEARCH_AND_RANKING.md        # Storage scanning, indexing, and investigation ranking
└── desktop-winui/
    ├── Groundwork.slnx              # .NET 10 Solution
    ├── src/
    │   ├── Groundwork.Engine/       # Core system inspection, diagnostics, optimization & agent engine
    │   │   ├── Models/              # Strongly typed domain, operation, tool, and investigation models
    │   │   └── Services/            # System services, SafeOperationEngine, ToolRegistry, Investigations
    │   ├── Groundwork.MftHelper/    # Elevated helper for NTFS USN/volume inspection
    │   └── Groundwork.Desktop/      # WinUI 3 native desktop application
    └── tests/
        └── Groundwork.Engine.Tests/ # Automated xUnit verification suite
```

---

## 4. Product Modules

1. **Overview**: Actionable system snapshot (CPU, RAM, Storage volumes, GPU, Network state, Startup count, Pending Reboot/Protection status, Recent Diagnostic Findings, Recent Operations, and Quick Investigation Launchers).
2. **Analyze**:
   - **Storage Analyzer**: Parallel Win32 `FindFirstFileExW` directory walker, bottom-up $O(N)$ folder size rollup, category breakdown, treemap/bars, flat largest files view, and CSV export/import.
   - **Hardware & System Diagnostics**: Deep WMI/SMBIOS/Registry/Win32 inspection (CPU, Motherboard/BIOS/SecureBoot, RAM & SPD slots, GPUs, Physical Disks & partition maps, OS/Uptime, Network Adapters, Signed Drivers, Live CPU/GPU/Disk telemetry, and Active Process Inspector).
3. **Optimize**:
   - **Power Management**: Inspect installed Windows power schemes (`powercfg`), explain tradeoffs, switch active scheme safely, and restore previous scheme.
   - **Startup Management**: Inspect Registry `Run` keys (`HKCU`/`HKLM`) and Startup folders, verify publisher/target executables, explain startup impact, and reversibly enable/disable entries with full backup state.
   - **Windows Performance & Privacy Configuration**: Inspect and reversibly configure Game Mode, Visual Transparency Effects, Hardware-Accelerated GPU Scheduling (HAGS) status, and privacy/telemetry settings with clear explanations.
4. **Troubleshoot**:
   - **Groundwork Investigations**: Guided, multi-step investigations for *Performance*, *Storage*, *Network*, *Windows Health*, *Startup*, *Hardware*, and *Custom User Queries* with exportable `.md` / `.json` / `.txt` reports.
   - **Network Troubleshooter**: Active interface inspection, IPv4/IPv6/Gateway/DNS verification, ICMP Ping, DNS resolution test, TCP connectivity check, and well-known DNS provider guidance.
   - **Event Log & Error Investigator**: Filtered Windows `System` and `Application` Event Log errors/critical events with plain-English explanations.
   - **Services & System Repair**: Key Windows service state auditing, Component-Based Servicing pending reboot check, PnP device error inspection, and guided `SFC` / `DISM` / Windows Update verification.
5. **Maintenance**:
   - **Storage Cleanup**: Token-gated Recycle Bin deletion (`SHFileOperationW`), Temp/CrashDump/Cache scanning, and Recycle Bin management.
   - **Duplicate Finder**: 3-stage pipeline (Size grouping → 4 KB head/tail pre-hash → Full SHA-256) with hard-link (`FileIndex`) and cloud placeholder protection.
   - **Smart File Organizer**: Categorizes cluttered folders (Downloads/Desktop) and executes reversible file organization with one-click Undo.
   - **Operation History & Rollback**: Complete audit log of all executed modifications with verification status and one-click rollback for reversible actions.
6. **Applications**: Fast Win32 Registry enumeration of installed software, monitored uninstaller execution, and bounded leftover file/registry cleanup.
7. **AI Assistant**: Tool-calling system assistant grounded in live system context and `ToolRegistryService`, supporting both deterministic local analysis and multi-provider LLMs.
8. **Settings**: AI provider configuration (DPAPI-encrypted keys), scan worker tuning, exclusion rules, and diagnostics verification.

---

## 5. Build & Verification Commands

- **Run all unit tests**:
  ```powershell
  dotnet test desktop-winui/Groundwork.slnx -c Release
  ```
- **Build the entire solution**:
  ```powershell
  dotnet build desktop-winui/Groundwork.slnx -c Release
  ```
- **Run the WinUI 3 Desktop application**:
  ```powershell
  dotnet run --project desktop-winui/src/Groundwork.Desktop/Groundwork.Desktop.csproj -c Release
  ```
