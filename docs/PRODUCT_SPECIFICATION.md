# Groundwork — Product Specification

## 1. Product Vision & Positioning

- **Product Name**: Groundwork
- **Category**: AI-Assisted Windows System Management & Diagnostics Toolkit
- **Positioning**: Groundwork is an intelligent native Windows system companion that helps users understand their computers, investigate problems, optimize Windows, and perform safe maintenance through a unified WinUI 3 desktop application.
- **Core Promise**: *Understand your PC. Investigate problems. Optimize with confidence. Maintain control.*

## 2. Dual Interaction Model

Groundwork treats two interaction styles as equally first-class:
1. **Direct Native Utilities**: Users manually inspect and configure storage, hardware, processes, startup entries, power schemes, network diagnostics, event logs, services, cleanup candidates, duplicates, and installed applications without touching an AI assistant.
2. **Agent-Driven & Guided Investigations**: Users describe symptoms in natural language or run structured **Groundwork Investigations** (*Performance*, *Storage*, *Network*, *Windows Health*, *Startup*, *Hardware*, *Custom*). The system selects registered diagnostic tools, gathers live Windows telemetry, distinguishes confirmed findings from potential causes and unverified hypotheses, and presents actionable, reversible recommendations.

## 3. Core Product Modules

### Module A — Overview
- Hardware summary (CPU, RAM capacity & usage, GPU, Disks, Motherboard/BIOS).
- Windows version, build, uptime, pending restart status, and system protection status.
- Storage capacity & utilization across fixed volumes.
- Network connectivity summary & active startup item count.
- Recent diagnostic findings, recent maintenance/optimization operations, and one-click launchers for Guided Investigations.

### Module B — Analyze
- **Storage Analysis**: Multi-drive parallel Win32 scanning (`FindFirstFileExW`), bottom-up folder size rollups, proportional category/folder visualization, flat largest file discovery, cloud placeholder identification, and CSV snapshot import/export.
- **Hardware & System Information**: CPU topology, RAM & SMBIOS SPD slot inspection, BIOS/Motherboard/SecureBoot, GPUs, Physical Disks & partition maps, Network Adapters, Signed Drivers, and live CPU/GPU/Disk performance counters.
- **Process & Resource Inspection**: Top CPU and memory-consuming processes, working set & private memory breakdown, thread/handle counts, and responsive filtering.

### Module C — Optimize
- **Power Management**: Inspect installed Windows power schemes (`powercfg`), explain performance vs. energy tradeoffs, switch active power scheme through the Safe Operation Engine, and restore the previous scheme.
- **Startup & Scheduled Logon Task Management**: Inspect `HKCU\...\Run`, `HKLM\...\Run`, `HKLM\...\WOW6432Node\...\Run`, User/Common Startup folders, and non-system Scheduled Logon Tasks (`schtasks`). Display publisher, command path, and impact explanation. Enable or disable user entries and scheduled tasks reversibly with full recovery metadata.
- **Windows Performance, Gaming, Background Apps, Privacy & Customization Configuration**: Inspect and configure Game Mode, Background Game DVR, Windowed Game Optimizations (Flip Model), Background Application Activity (`GlobalUserDisabled`), Visual Transparency Effects, Hardware-Accelerated GPU Scheduling (HAGS) status, Advertising ID, Tailored Experiences, Activity History, Windows 11 Taskbar Alignment, and File Explorer File Extension / Hidden File visibility with clear explanations of what each setting modifies.

### Module D — Troubleshoot
- **Groundwork Investigations**: Task-oriented multi-tool investigations for *Performance*, *Storage*, *Network*, *Windows Health*, *Startup*, *Hardware*, and *Custom* queries. Separates **Confirmed Observations**, **Potential Contributing Factors**, and **Unverified Hypotheses**, and exports structured reports (`.md`, `.json`, `.txt`).
- **Network Troubleshooting & DNS Provider Switching**: Adapter status, IPv4/IPv6/Gateway/DNS server configuration, ICMP Ping to gateway and external hosts, DNS resolution test, DNS cache flushing (`ipconfig /flushdns`), and reversible DNS provider switching (`Cloudflare 1.1.1.1`, `Google 8.8.8.8`, `Quad9 9.9.9.9`, or `Automatic DHCP`) through `SafeOperationEngine`.
- **Event & Error Investigation**: Windows `System` and `Application` Event Log error/critical filtering with plain-English explanations and diagnostic context.
- **Services & Windows Health/Repair**: Key Windows service state inspection, Component-Based Servicing pending reboot check, PnP device error auditing, System Restore point creation, and guided `DISM /CheckHealth` and `SFC` verification.

### Module E — Maintenance
- **Safe Cleanup & Browser Cache Management**: Token-gated Recycle Bin transfers (`SHFileOperationW`), temporary files (`%TEMP%`), crash dumps, safe browser cache inspection and cleanup (Microsoft Edge, Google Chrome, Brave, Mozilla Firefox cache-only directories without touching cookies, sessions, or passwords), and Recycle Bin querying/emptying.
- **System Restore Point Creation**: Approval-gated creation of Windows System Restore checkpoints prior to major system maintenance.
- **Duplicate File Management**: 3-stage pipeline (size grouping → 4 KB head/tail SHA-256 → full SHA-256) with hard-link (`VolumeId` + `FileIndex`) and cloud placeholder protection.
- **Smart File Organizer**: Categorizes cluttered user directories (`Downloads`, `Desktop`) into structured subfolders, executes moves via `SafeOperationEngine`, and provides verified one-click Undo.
- **Operation History & Rollback Ledger**: Persistent local record of every modifying operation, including pre-change state, verification outcome, and rollback trigger.

### Module F — Applications
- Multi-hive Win32 Registry enumeration of installed applications, icon extraction, safe uninstaller execution, and bounded post-uninstall leftover file & registry detection.

### Module G — AI Assistant
- System-aware agent backed by `ToolRegistryService`, `AgentPlannerService`, and `AgentSystemContextBuilder`. Works deterministically offline or with local `Ollama` and cloud providers (`Gemini`, `OpenAI`, `Anthropic`, `Mistral`, `Custom`), with direct approval and execution of prepared `OperationProposal` actions.

### Module H — Settings
- AI provider selection, DPAPI-encrypted API key storage, scanner concurrency tuning, directory exclusion rules, and engine self-diagnostics.

---

## 4. Feature Research, Evaluation & Prioritization Classification

Every candidate Windows utility capability is evaluated by practical user value, technical reliability, security boundaries, and maintainability:

### 4.1 Essential Capabilities (Implemented & Verified)
1. **Power Plan Management (`power.switch_plan`)**: Inspects active and available `powercfg` schemes, explains CPU boost and idle power tradeoffs, switches schemes, verifies state, and restores the prior scheme on rollback.
2. **Startup Application, Registry & Scheduled Logon Task Management (`startup.toggle_item`)**: Unified discovery across `HKCU`/`HKLM` `Run` keys, Startup folders, and non-system Scheduled Logon Tasks (`schtasks`), with publisher verification, impact explanation, and reversible enable/disable.
3. **Transparent Windows Performance, Gaming, Background Apps, Privacy & Customization Controls (`settings.toggle_user_setting`)**: Individual, reversible `HKCU` controls for Game Mode, Game DVR, Windowed Game Optimizations, Background App Activity, Acrylic/Mica Transparency, Advertising ID, Tailored Experiences, Activity History, Taskbar Alignment, File Extensions, and Hidden Files.
4. **Network Diagnostics, DNS Cache Flush & DNS Provider Switching (`network.flush_dns`, `network.switch_dns`)**: Live adapter inspection, Gateway/External ICMP Ping, DNS lookup timing, DNS cache purge, and reversible DNS provider switching (`Cloudflare`, `Google`, `Quad9`, `Automatic DHCP`).
5. **Safe Temporary File, Crash Dump & Browser Cache Cleanup (`cleanup.safe_temp_and_cache`)**: Inspects `%TEMP%`, `%LOCALAPPDATA%\CrashDumps`, and browser HTTP/Code/GPU caches (Edge, Chrome, Brave, Firefox) while verifying browser processes are closed and preserving all user sessions, passwords, and history.
6. **Event Viewer Error Translation & Core Windows Service Auditing**: Queries `System` and `Application` Event Logs for recent Critical/Error/Warning events with plain-English explanations and audits 14 core Windows services.

### 4.2 Important Capabilities (Implemented & Verified)
1. **Guided DISM Component Store Health Verification (`repair.verify_dism_health`)**: Approval-gated execution of `DISM /Online /Cleanup-Image /CheckHealth` with structured parsing and verification.
2. **System Restore Point Creation (`maintenance.create_restore_point`)**: Approval-gated creation of a Windows System Restore checkpoint with elevation prerequisite validation and post-creation verification.
3. **Smart File Organizer with One-Click Rollback (`organize.directory`)**: Categorizes loose files and records full move manifests in `OperationHistoryService` for one-click Undo.

### 4.3 Advanced Capabilities (Supported & Scoped)
1. **NTFS Master File Table (MFT) Inspection (`Groundwork.MftHelper`)**: Optional elevated volume metadata helper with automatic fallback to the multi-threaded Win32 `FindFirstFileExW` directory walker.
2. **Monitored Application Uninstallation & Bounded Leftover Cleanup**: Launches official vendor uninstallers, waits for process completion, and scans bounded `AppData`/`ProgramData`/Registry paths for residual files.

### 4.4 Deferred Capabilities (Explicitly Excluded for Safety & Reliability)
1. **Opaque "One-Click Booster" or Bulk Registry Cleaners**: Modifying dozens of undocumented registry keys or deleting arbitrary COM/CLSID entries risks breaking applications with no measurable performance benefit.
2. **Periodic RAM Standby List Purging Loops**: Forcibly flushing the Windows standby memory list evicts cached pages needed by active applications, causing hard page faults and micro-stuttering.
3. **Disabling Core Security or Update Services (`WinDefend`, `mpssvc`, `wuauserv`)**: Groundwork audits these services to help users *fix* broken states, never to disable security protections.
4. **Unattended Windows ISO / Deployment Image Modification**: Slipstreaming drivers or stripping system components from installation media is outside the scope of a safe live-system diagnostic companion.
