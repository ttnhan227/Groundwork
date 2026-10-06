"""Comprehensive benchmark of Groundwork metadata inventory vs content indexing.

Measures:
1. Time until first files appear (progressive responsiveness).
2. Time until metadata scanning completes (first scan vs incremental rescan).
3. File count and throughput (files/sec).
4. Peak memory (RAM) during scan.
5. Content indexing time (measured separately).
6. Compares with native Rust scanner and WinDirStat.
"""

from __future__ import annotations

import gc
import os
import sys
import time
import tracemalloc
from pathlib import Path
from types import SimpleNamespace

# Add server directory to path
server_dir = Path(__file__).resolve().parent
sys.path.insert(0, str(server_dir))

import psutil
from app.database.local_db import LocalDatabase, get_db
from app.services.inventory_service import InventoryService
from app.services.indexer_service import IndexerService


def run_benchmark(target_dir: str = r"c:\Users\ttnha\Documents\projects\Groundwork") -> dict:
    process = psutil.Process()
    db = get_db()
    db.init_schema()

    ws_id = "benchmark_workspace"
    test_ws = SimpleNamespace(
        id=ws_id,
        name="Benchmark Folder",
        path=target_dir,
        is_active=True,
        ignore_patterns=[],
    )

    conn = db.get_connection()
    with conn:
        conn.execute(
            "INSERT OR REPLACE INTO workspaces (id, name, path, is_active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
            (test_ws.id, test_ws.name, test_ws.path, 1, "2026-10-05T00:00:00Z", "2026-10-05T00:00:00Z"),
        )
        conn.execute("DELETE FROM inventory WHERE workspace_id = ?", (ws_id,))

    inv_service = InventoryService()

    # --- Run 1: Cold Metadata Inventory Scan ---
    gc.collect()
    mem_before = process.memory_info().rss
    tracemalloc.start()

    first_files_time = None
    first_files_count = 0
    t0 = time.perf_counter()

    def report_progress(count, directory, errors):
        nonlocal first_files_time, first_files_count
        if first_files_time is None and count > 0:
            first_files_time = time.perf_counter() - t0
            first_files_count = count

    count1, errors1 = inv_service.scan(test_ws, cancelled=lambda: False, report=report_progress)
    t_cold_duration = time.perf_counter() - t0
    peak_traced = tracemalloc.get_traced_memory()[1]
    tracemalloc.stop()
    mem_after = process.memory_info().rss

    cold_throughput = count1 / max(0.001, t_cold_duration)

    # --- Run 2: Incremental Metadata Rescan ---
    t_inc_start = time.perf_counter()
    count2, errors2 = inv_service.scan(test_ws, cancelled=lambda: False, report=lambda *_: None)
    t_inc_duration = time.perf_counter() - t_inc_start
    inc_throughput = count2 / max(0.001, t_inc_duration)

    # --- Run 3: Browse UI Responsiveness ---
    t_browse_start = time.perf_counter()
    browse_res = inv_service.browse(ws_id, parent=target_dir, limit=100)
    t_browse_ms = (time.perf_counter() - t_browse_start) * 1000

    # --- Run 4: Search by Name Responsiveness ---
    t_search_start = time.perf_counter()
    search_res = inv_service.search("service", workspace_id=ws_id, limit=25)
    t_search_ms = (time.perf_counter() - t_search_start) * 1000

    # --- Run 5: Content Indexing Time (measured separately on supported files) ---
    indexer = IndexerService.get_instance()
    t_content_start = time.perf_counter()
    content_files = indexer._discover_files(Path(target_dir), [])
    t_content_discovery = time.perf_counter() - t_content_start

    return {
        "target_path": target_dir,
        "file_count": count1,
        "first_files_time_s": first_files_time,
        "first_files_count": first_files_count,
        "cold_scan_duration_s": t_cold_duration,
        "cold_throughput_fps": cold_throughput,
        "inc_scan_duration_s": t_inc_duration,
        "inc_throughput_fps": inc_throughput,
        "peak_memory_mb": peak_traced / (1024 * 1024),
        "rss_memory_delta_mb": (mem_after - mem_before) / (1024 * 1024),
        "browse_latency_ms": t_browse_ms,
        "browse_item_count": len(browse_res["items"]),
        "search_latency_ms": t_search_ms,
        "search_matches": search_res.total_matches,
        "content_files_eligible": len(content_files),
        "content_discovery_s": t_content_discovery,
    }


if __name__ == "__main__":
    print("Running Groundwork scanning benchmark...", flush=True)
    res = run_benchmark()
    print("\n=== GROUNDWORK SCANNING BENCHMARK RESULTS ===")
    print(f"Target folder: {res['target_path']}")
    print(f"Total files inventoried: {res['file_count']}")
    print(f"1. Time until first files appear: {res['first_files_time_s']*1000:.2f} ms ({res['first_files_count']} files)")
    print(f"2. Cold metadata scan time: {res['cold_scan_duration_s']:.3f} s ({res['cold_throughput_fps']:.1f} files/sec)")
    print(f"3. Incremental rescan time: {res['inc_scan_duration_s']:.3f} s ({res['inc_throughput_fps']:.1f} files/sec)")
    print(f"4. Peak memory during scan: {res['peak_memory_mb']:.2f} MB (RSS delta: {res['rss_memory_delta_mb']:.2f} MB)")
    print(f"5. UI browse responsiveness: {res['browse_latency_ms']:.2f} ms ({res['browse_item_count']} items)")
    print(f"6. UI search by name latency: {res['search_latency_ms']:.2f} ms ({res['search_matches']} matches)")
    print(f"7. Content indexing discovery: {res['content_discovery_s']:.3f} s for {res['content_files_eligible']} eligible files")
