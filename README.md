# Groundwork

<p align="center">
  <img src="client/public/logo-mark.png" alt="Groundwork logo" width="88" height="88" />
</p>

<p align="center">
  <strong>Native Windows High-Speed Storage Analyzer, Hardware Topology Inspector, Uninstaller & AI Workspace</strong>
</p>

<p align="center">
  <a href="https://github.com/ttnhan227/Groundwork/actions/workflows/release.yml"><img src="https://img.shields.io/github/actions/workflow/status/ttnhan227/Groundwork/release.yml?branch=main&amp;label=Release&amp;style=flat-square" alt="Release status" /></a>
  <img src="https://img.shields.io/badge/.NET-10.0-512BD4?style=flat-square&amp;logo=dotnet&amp;logoColor=white" alt=".NET 10" />
  <img src="https://img.shields.io/badge/Windows-WinUI_3-0078D4?style=flat-square&amp;logo=windows&amp;logoColor=white" alt="WinUI 3 Fluent" />
  <img src="https://img.shields.io/badge/Platform-Windows_10%2F11_x64-00ADEF?style=flat-square" alt="Windows 10/11 x64" />
</p>

---

## 📌 Overview

**Groundwork** is a high-performance native Windows desktop utility combining:
1. **Storage & Disk Analysis**: Configurable multi-worker Windows file enumeration, per-volume analysis, and interactive proportional folder space maps.
2. **Hardware & System Diagnostics**: Real-time hardware topology, detailed processor specs, motherboard and BIOS firmware status, memory SPD modules, multi-GPU metrics, physical disk inventory, and WHQL signed drivers.
3. **Application Uninstaller & Leftover Cleaner**: Confirmed vendor uninstalls with bounded `AppData` / `ProgramData` leftover detection and separately reviewed cleanup.
4. **Cryptographic SHA-256 Duplicate Cleaner**: 3-stage duplicate file elimination with Recycle Bin safety guarantees and cloud placeholder protection.
5. **Multi-Provider AI Agent**: 100% offline local LLMs via Ollama, Google Gemini, or OpenAI with grounded citations back to your local files.
6. **Power-User Settings Hub**: File size units, serial masking, configurable scan workers and exclusions, and cleanup confirmation safeguards.

---

## ⚡ Core Capabilities

### 1. 🗄️ Storage Analysis
- **Multi-Worker Walker**: Uses native Win32 `FindFirstFileExW` with `FIND_FIRST_EX_LARGE_FETCH` across 2–16 configurable workers.
- **Exclusions**: Configurable directory-name, path, and extension exclusions apply to volume and folder scans.
- **Traversal Safety**: Junctions and symbolic links are skipped to avoid cycles and cross-volume traversal. Raw MFT parsing is not available in this build.
- **Interactive Breakdown**: Drill into folder trees, sort largest flat files, and visualize proportional space usage across all mounted volumes.

### 2. 💻 Hardware & System Diagnostics
- **Central Processor (CPU Specs)**: Live detection of physical cores, logical processors, socket, frequency, L2/L3 caches, and hardware virtualization (VT-x / AMD SVM).
- **Motherboard & BIOS**: Baseboard model, manufacturer, serial number (with privacy masking), BIOS release date/version, and UEFI Secure Boot state.
- **Memory SPD Topology**: Live RAM usage %, DDR generation, clock speeds, populated vs. total slots, and per-module manufacturer part numbers.
- **Physical Disks & Multi-GPU**: NVMe/SATA drive health and partition maps; discrete + integrated GPU VRAM and display refresh rates.
- **WHQL Signed Drivers**: Enumeration of verified system drivers across network, storage, and system classes.
- **Export Reports**: Generate standardized plain-text diagnostic reports or structured JSON exports.

### 3. 🛡️ Cleanup Safety & Leftover Scanner
- **Recycle Bin Guaranteed**: Every cleanup action defaults strictly to shell recycling (`SHFileOperation`). Permanent deletion is never executed silently.
- **Leftover Detection**: Scans `AppData\Local`, `AppData\Roaming`, and `ProgramData` for abandoned application traces after uninstallation.
- **Safety Safeguards**: Protected Windows directories (`\Windows`, `\System32`, `\Boot`) are permanently blocked from deletion.

### 4. 🤖 Multi-Provider AI Agent & Document Reader
- **Offline & Cloud Flexibility**: Connect a 100% free offline local model via Ollama (e.g. `llama3.2`, `mistral`, `qwen2.5`) or connect via Google Gemini or OpenAI.
- **Test Connection Verification**: Live connection test buttons in Settings confirm provider health before enabling the Agent.
- **Strict Evidence Citation**: AI answers cite line numbers, document excerpts, and storage metrics directly from your files.

---

## 📥 Installation & Download

Groundwork is distributed as a self-contained 64-bit Windows application for **Windows 10 (Build 19041+) and Windows 11**.

### Official Release Packages
Download from the [GitHub Releases](https://github.com/ttnhan227/Groundwork/releases) page:

| Package | Format | Description |
|---|---|---|
| **`Groundwork-vX.Y.Z-windows-x64-setup.exe`** | Setup Installer | Recommended installer. |
| **`Groundwork-v1.0.0-windows-x64.zip`** | Portable Archive | Fully self-contained portable package. Extract and run `Groundwork.Desktop.exe`. |

*No separate runtime installations (.NET SDK, Python, or VC++ runtimes) are required.*

---

## 🛠️ Building from Source

### Prerequisites
- Windows 10 or 11 (x64)
- [.NET 10.0 SDK](https://dotnet.microsoft.com/download)
- Visual Studio 2022 / Build Tools with the **Windows App SDK / WinUI 3** workload
- [Inno Setup 6](https://jrsoftware.org/isdl.php) (optional, for compiling the setup installer)

### Run for Development

**Option 1: Visual Studio**
1. Open `desktop-winui/Groundwork.slnx`.
2. Set `Groundwork.Desktop` as the startup project and choose the **x64** platform.
3. Press **F5** to run with the debugger.

**Option 2: Command line**

```powershell
dotnet run --project desktop-winui/src/Groundwork.Desktop/Groundwork.Desktop.csproj -p:Platform=x64
```

If the app doesn't open from `dotnet run`, build it and start the executable under `desktop-winui/src/Groundwork.Desktop/bin/x64/Debug/` directly.

### Quick Build & Test

```powershell
# Clone the repository
git clone https://github.com/ttnhan227/Groundwork.git
cd Groundwork

# Run automated unit tests (C# Engine + Hardware Specs + Safety)
dotnet test desktop-winui/Groundwork.slnx -c Release

# Build native desktop application
dotnet build desktop-winui/Groundwork.slnx -c Release

# Or generate the complete production release bundle and setup installer
./.github/scripts/build-windows-release.ps1
```

---

## 📄 License & Attribution

Groundwork is open-source software licensed under the MIT License. Developed by Tran Trong Nhan and contributors.
