# Changelog

All notable changes to **Groundwork** are documented in this file.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [1.0.0] - 2026-10-23

### Initial Public Release — Native Windows Edition

Groundwork 1.0 is a local-first Windows utility designed for high-speed storage analysis, safe duplicate detection and cleanup, installed application and leftover management, and privacy-first local search and assistance.

#### Key Features

- **Native Windows Fluent Application (WinUI 3 + .NET 10)**:
  - Built with modern Windows 11 Fluent design, Acrylic/Mica backdrops, and native controls.
  - Zero WebView2 UI overhead.
  - 7 functional navigation views: Computer Overview, Storage Analyzer, Duplicate Cleaner, Installed Applications, Local Search, Organization, and Assistant.

- **High-Speed Storage Analysis**:
  - High-throughput parallel Win32 directory walker (`FindFirstFileExW` / `FindNextFileW` with `FIND_FIRST_EX_LARGE_FETCH`).
  - Capable of scanning 108,000–126,000 files/second on NVMe storage.
  - Bottom-up folder size rollups, file category categorization, and proportional interactive space breakdown.

- **3-Stage Safe Duplicate File Detection**:
  - **Stage 1**: Exact file size grouping.
  - **Stage 2**: 8 KB fast head/tail hash check to eliminate non-matching candidate pairs without reading whole files.
  - **Stage 3**: Full SHA-256 cryptographic verification for confirmed identical content.
  - **Cloud Placeholder Safe**: Skips offline OneDrive/iCloud placeholders (`FILE_ATTRIBUTE_RECALL_ON_DATA_ACCESS`, `FILE_ATTRIBUTE_OFFLINE`) to prevent unwanted multi-gigabyte cloud downloads.
  - **Hard Link Aware**: Recognizes identical NTFS file references sharing the same physical inode to prevent redundant cleanup.

- **Application & Leftover Management**:
  - Comprehensive enumeration of 32-bit and 64-bit Win32 registry installations and modern Appx / MSIX packages.
  - Asynchronous monitored uninstallation: tracks child uninstaller processes with exit code verification.
  - High-confidence post-uninstall leftover detection across `AppData\Local`, `AppData\Roaming`, and `ProgramData`.

- **Local-First Privacy & AI Operator**:
  - 100% offline capable: core scanning, duplicates, and cleanup operate without any internet connection or cloud API keys.
  - Bundled local ONNX embeddings (`all-MiniLM-L6-v2`) and PortableGit for workspace indexing.
  - Safe tool execution boundary for AI operations.

---

### Safety Guarantees & Safeguards

- **Exclusively Recycle Bin Deletion**:
  - Cleanup actions default strictly to the Windows Recycle Bin (`SHFileOperation` / shell recycling).
  - Silent permanent deletion (`os.unlink` / `File.Delete`) as a hidden fallback has been completely eliminated. If an item cannot be recycled (e.g. drive quota or access restriction), the operation aborts with a clear, actionable error.
- **Protected System Paths**:
  - Strict, case-insensitive boundary checks prevent any cleanup or file operations inside critical Windows paths:
    `\Windows`, `\System32`, `\SysWOW64`, `\WinSxS`, `\Recovery`, `\$Recycle.Bin`, `\System Volume Information`, `\Boot`, and `\PerfLogs`.
- **Reparse Point & Symlink Protection**:
  - Directory junctions and symbolic links are detected and inspected; scanners will not traverse junctions that point outside the selected scan root or into protected directories.
- **Child Process Lifecycle Management**:
  - Background sidecar processes are bound to a Win32 Job Object with `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`. Closing Groundwork automatically terminates background workers without leaving orphaned processes.

---

### Distribution, Verification & Known Limitations

- **Self-Contained & Portable**:
  - Bundles the .NET 10 CLR (`coreclr.dll`), JIT (`clrjit.dll`), Windows App SDK libraries, and a standalone Python sidecar (`groundwork-core.exe`).
  - No separate installation of .NET runtimes, Python, or command-line developer tools is required.
- **Unsigned Binaries & Windows SmartScreen**:
  - Groundwork 1.0 binaries are currently unsigned (no paid commercial Authenticode EV/OV certificate).
  - On first launch, Windows SmartScreen may show an *"Unknown Publisher"* warning.
  - **How to verify**: Users can check the authenticity of their download against the published `checksums.txt` using PowerShell:
    ```powershell
    Get-FileHash -Algorithm SHA256 .\Groundwork-v1.0.0-windows-x64.zip
    ```
    Then confirm that the hash matches the release digest on GitHub before clicking **More info** $\to$ **Run anyway**.
- **Scanner Architecture Clarification**:
  - Storage scanning is powered by an optimized parallel Win32 directory walker, not raw unmanaged `$MFT` disk parsing. It provides near-instant directory analysis without requiring kernel-level drivers or raw-disk volume handles.
- **Updates**:
  - Groundwork 1.0 does not include a background auto-updater. The website and releases page detect new versions; updating is performed by downloading the latest release archive.
