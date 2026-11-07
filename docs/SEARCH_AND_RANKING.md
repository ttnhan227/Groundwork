# Groundwork — Storage Scanning, Filtering & Investigation Ranking

## 1. Parallel Win32 Storage Scanning (`Win32StorageScanner`)

Groundwork scans local NTFS/exFAT/FAT32 volumes without requiring administrator privileges by default:
1. **Unbuffered Enumeration**: Uses `FindFirstFileExW` with `FindExInfoBasic` and `FIND_FIRST_EX_LARGE_FETCH` across a configurable worker pool (`StorageScanOptions.MaxWorkers`, defaulting to logical core count bounded between 2 and 16).
2. **Reparse Point & Cloud Guardrails**:
   - Skips directory reparse points (`FILE_ATTRIBUTE_REPARSE_POINT`) to eliminate infinite junction/symlink recursion and prevent double-counting.
   - Identifies cloud placeholders (`FILE_ATTRIBUTE_RECALL_ON_DATA_ACCESS`, `FILE_ATTRIBUTE_RECALL_ON_OPEN`, `FILE_ATTRIBUTE_OFFLINE`) so cloud-only files are neverhydrated during scans or duplicate hashing.
3. **Bottom-Up $O(N)$ Directory Rollup**:
   - Rather than recursively walking subtrees per folder ($O(N^2)$), files are accumulated into their immediate parent directory bucket first, and total sizes are rolled up bottom-up by directory depth descending in a single $O(N)$ pass.

---

## 2. Three-Stage Duplicate Detection (`DuplicateEngineService`)

To identify exact duplicate files safely without unnecessary disk I/O:
1. **Stage 1 — Size Grouping**: Groups local non-placeholder files by exact byte length (`SizeBytes >= MinSizeBytes`). Unique sizes are immediately discarded.
2. **Stage 2 — 4 KB Head + 4 KB Tail Pre-Hash**: Reads only the first 4,096 bytes and last 4,096 bytes (plus file length) via `SHA256`. Groups with distinct pre-hashes are discarded without reading the middle of large files.
3. **Stage 3 — Full SHA-256 & Hard-Link Filtering**:
   - Queries `GetFileInformationByHandle` to extract `(VolumeSerialNumber, FileIndexHigh, FileIndexLow)`. Files sharing the same NTFS `FileIndex` on the same volume are hard links to the same physical allocation and are excluded from duplicate deletion candidates.
   - Computes full-stream `SHA256` with `FileOptions.SequentialScan` and marks the oldest/primary file in each group as `Keep (Original)` while ranking newer copies as reclaimable.

---

## 3. Investigation Evidence Ranking (`InvestigationEngineService`)

When running a **Groundwork Investigation** (*Performance*, *Storage*, *Network*, *Windows Health*, *Startup*, *Hardware*, or *Custom*):
1. **Deterministic Tool Selection (`AgentPlannerService`)**: Maps user symptoms and investigation categories to the minimal set of read-only diagnostic tools required to gather authoritative evidence.
2. **Evidence Classification**:
   - **Confirmed Observations**: Direct measurements exceeding objective thresholds (e.g., volume free space $< 10\%$, memory utilization $> 85\%$, pending Windows reboot flags present, active gateway ping timeout, or missing startup target executable).
   - **Potential Contributing Factors**: Correlated findings that may explain the user's symptom (e.g., high number of enabled third-party startup items, power plan set to *Power Saver* during performance complaints, recent application crash events in Event Log).
   - **Unverified Hypotheses**: Factors that cannot be confirmed without additional sensors or external hardware inspection (e.g., thermal throttling when CPU package temperature is not exposed by standard WMI, ISP upstream routing outages when local gateway responds normally).
3. **Recommendation Prioritization**: Recommended actions are ordered by highest confirmed impact and lowest risk (`ReadOnly` / `Reversible` actions first).
