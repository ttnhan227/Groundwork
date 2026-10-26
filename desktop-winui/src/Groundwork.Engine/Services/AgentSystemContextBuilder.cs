using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using Groundwork.Engine.Models;

namespace Groundwork.Engine.Services;

public static class AgentSystemContextBuilder
{
    private const string ContextLimitMarker = "\n[Remaining context omitted after the explicit character limit.]";

    public static string Build(
        HardwareSystemReport? report,
        IEnumerable<VolumeMetadata>? volumes,
        DateTime? volumeSnapshotUtc = null)
    {
        var context = new StringBuilder();
        context.AppendLine("=== SYSTEM INVENTORY ===");

        if (report == null)
        {
            context.AppendLine("Hardware inventory: unavailable; collection has not succeeded in this session.");
        }
        else
        {
            context.AppendLine($"Hardware inventory collected: {report.ReportGeneratedUtc.ToUniversalTime():yyyy-MM-dd HH:mm:ss} UTC.");
            if (DateTime.UtcNow - report.ReportGeneratedUtc.ToUniversalTime() > TimeSpan.FromMinutes(5))
            {
                context.AppendLine("This is a cached snapshot older than five minutes; dynamic memory availability is historical and must not be stated as current.");
            }
            context.AppendLine("Source: Groundwork Windows hardware collector (WMI and Windows APIs); values are reported observations, not estimates.");
            context.AppendLine("CPU:");
            context.AppendLine($"- Model: {Known(report.Cpu.Name)}");
            context.AppendLine($"- Manufacturer: {Known(report.Cpu.Manufacturer)}");
            context.AppendLine($"- Physical cores / logical processors: {KnownPositive(report.Cpu.PhysicalCores)} / {KnownPositive(report.Cpu.LogicalProcessors)}");
            context.AppendLine($"- Maximum reported clock: {KnownPositive(report.Cpu.MaxClockSpeedMHz, " MHz")}");
            context.AppendLine($"- Socket: {Known(report.Cpu.Socket)}");
            context.AppendLine($"- CPU architecture: {Known(report.Cpu.Architecture)} (collector process architecture; not independently verified CPU ISA)");

            context.AppendLine("GPU devices:");
            if (report.Gpus.Count == 0)
            {
                context.AppendLine("- No GPU records returned; device presence and graphics capabilities are unknown.");
            }
            foreach (var gpu in report.Gpus)
            {
                context.AppendLine($"- {Known(gpu.Name)}; driver {Known(gpu.DriverVersion)} ({Known(gpu.DriverDate)}); reported dedicated memory {KnownPositive(gpu.DedicatedMemoryBytes, " bytes")}.");
                context.AppendLine($"  VRAM source is Windows WMI AdapterRAM and may be limited/inaccurate on some adapters. Video processor: {Known(gpu.VideoProcessor)}.");
            }

            context.AppendLine("Motherboard and firmware:");
            context.AppendLine($"- Manufacturer / model / version: {Known(report.Motherboard.Manufacturer)} / {Known(report.Motherboard.Product)} / {Known(report.Motherboard.Version)}");
            context.AppendLine($"- BIOS: {Known(report.Motherboard.BiosVendor)} {Known(report.Motherboard.BiosVersion)} ({Known(report.Motherboard.BiosReleaseDate)})");

            context.AppendLine("Memory:");
            context.AppendLine($"- Installed physical memory: {KnownPositive(report.Memory.TotalPhysicalBytes, " bytes")}");
            context.AppendLine($"- Available at inventory time: {KnownPositive(report.Memory.AvailablePhysicalBytes, " bytes")}");
            context.AppendLine($"- Memory type: {KnownMemoryType(report.Memory.MemoryType)}; configured speed: {KnownPositive(report.Memory.ConfiguredSpeedMHz, " MHz")}");
            context.AppendLine($"- Populated modules reported: {KnownCount(report.Memory.PopulatedSlots)}; total slots: {KnownCount(report.Memory.TotalSlots)}");

            context.AppendLine("Live diagnostics:");
            string liveSampleTime = report.LiveDiagnostics.CollectedUtc == default
                ? "unknown (no timestamp in this cached report)"
                : $"{report.LiveDiagnostics.CollectedUtc.ToUniversalTime():yyyy-MM-dd HH:mm:ss} UTC";
            context.AppendLine($"- Sample time: {liveSampleTime}.");
            context.AppendLine($"- CPU utilization: {KnownPercent(report.LiveDiagnostics.CpuUtilizationPercent)}; available memory: {KnownPositive(report.LiveDiagnostics.AvailableMemoryBytes ?? 0, " bytes")}.");
            context.AppendLine($"- Maximum reported GPU engine utilization: {KnownPercent(report.LiveDiagnostics.GpuEngineUtilizationPercent)} (not whole-GPU utilization).");
            context.AppendLine($"- Total disk read / write: {KnownRate(report.LiveDiagnostics.DiskReadBytesPerSecond)} / {KnownRate(report.LiveDiagnostics.DiskWriteBytesPerSecond)}.");
            context.AppendLine($"- D3D11 hardware feature level: {Known(report.LiveDiagnostics.Direct3DFeatureLevel)}; this is not the installed DirectX runtime version.");
            context.AppendLine($"- Pending restart indicator: {report.LiveDiagnostics.RestartPending?.ToString() ?? "unknown"}.");
            if (report.LiveDiagnostics.DeviceErrors.Count == 0)
            {
                context.AppendLine("- Device error codes: none returned by the Windows device query.");
            }
            else
            {
                foreach (string deviceError in report.LiveDiagnostics.DeviceErrors.Take(20))
                {
                    context.AppendLine($"- Device error: {deviceError}");
                }
            }
            foreach (string warning in report.LiveDiagnostics.CollectionWarnings.Take(10))
            {
                context.AppendLine($"- Diagnostic collection warning: {warning}");
            }

            context.AppendLine("Physical disks (not logical volumes):");
            if (report.Disks.Count == 0)
            {
                context.AppendLine("- No physical disk records returned; disk inventory is unknown.");
            }
            foreach (var disk in report.Disks)
            {
                context.AppendLine($"- {Known(disk.Model)}; size {KnownPositive(disk.SizeBytes, " bytes")}; interface {Known(disk.InterfaceType)}; media {Known(disk.MediaType)}; status {Known(disk.Status)}.");
                context.AppendLine($"  Associated drive-letter volumes reported by WMI: {Known(disk.AssociatedVolumes)}. Do not infer physical disk count from drive letters.");
            }

            context.AppendLine("Operating system:");
            context.AppendLine($"- {Known(report.Os.Caption)}; version {Known(report.Os.Version)}; build {Known(report.Os.BuildNumber)}; architecture {Known(report.Os.Architecture)}.");
        }

        context.AppendLine();
        context.AppendLine("=== LOGICAL VOLUMES (FRESH SNAPSHOT) ===");
        context.AppendLine($"Snapshot time: {(volumeSnapshotUtc ?? DateTime.UtcNow).ToUniversalTime():yyyy-MM-dd HH:mm:ss} UTC.");
        context.AppendLine("Each row is a logical volume, not necessarily a separate physical disk. Filesystem is distinct from drive type.");
        var volumeList = volumes?.ToArray() ?? Array.Empty<VolumeMetadata>();
        if (volumeList.Length == 0)
        {
            context.AppendLine("- No accessible logical volumes were returned.");
        }
        foreach (var volume in volumeList)
        {
            if (!volume.IsReady)
            {
                context.AppendLine($"- {volume.RootPath} ({volume.VolumeName}): not ready; capacity and free space unavailable.");
                continue;
            }

            context.AppendLine($"- {volume.RootPath} ({volume.VolumeName}): filesystem {Known(volume.FileSystem)}, drive type {Known(volume.DriveType)}, free {HardwareSpecsEngineService.FormatBytes(volume.FreeBytes)} of {HardwareSpecsEngineService.FormatBytes(volume.TotalBytes)}.");
        }

        context.AppendLine();
        context.AppendLine("=== NOT COLLECTED / NOT ESTABLISHED ===");
        context.AppendLine("- M.2 slot count, NVMe capability per slot, occupancy, and lane sharing are unknown unless verified from the exact system model and authoritative specifications.");
        context.AppendLine("- CPU/GPU temperatures and throttling are not collected because Windows provides no reliable universal read-only source across hardware vendors.");
        context.AppendLine("- Game-library locations and game-specific installation paths are not exhaustively indexed by this system inventory.");
        context.AppendLine("- For game compatibility, compare CPU, GPU/VRAM, installed RAM, OS, graphics capabilities, and fresh free space against official requirements only when an authoritative source was actually retrieved.");
        context.AppendLine("- Never infer motherboard upgrade support or M.2 slot details from installed disks or logical volumes. State what evidence is missing.");
        context.AppendLine("- Do not claim a live measurement, compatibility lookup, or authoritative web lookup unless a corresponding current source was actually queried.");

        return context.ToString();
    }

    public static string LimitContext(string context, int maxCharacters)
    {
        ArgumentNullException.ThrowIfNull(context);
        if (maxCharacters <= ContextLimitMarker.Length)
        {
            throw new ArgumentOutOfRangeException(nameof(maxCharacters));
        }
        if (context.Length <= maxCharacters)
        {
            return context;
        }

        return context[..(maxCharacters - ContextLimitMarker.Length)] + ContextLimitMarker;
    }

    private static string Known(string? value) =>
        string.IsNullOrWhiteSpace(value) || value.StartsWith("Unknown", StringComparison.OrdinalIgnoreCase) || value.Equals("N/A", StringComparison.OrdinalIgnoreCase)
            ? "unknown"
            : value.Trim();

    private static string KnownPositive(long value, string suffix = "") => value > 0 ? $"{value:N0}{suffix}" : "unknown";

    private static string KnownPercent(double? value) => value.HasValue ? $"{Math.Clamp(value.Value, 0, 100):F1}%" : "unknown";

    private static string KnownRate(long? value) => value.HasValue ? $"{HardwareSpecsEngineService.FormatBytes(value.Value)}/s" : "unknown";

    private static string KnownCount(int value) => value > 0 ? value.ToString() : "unknown";

    private static string KnownMemoryType(string? value) =>
        string.IsNullOrWhiteSpace(value) || value.Contains('/') || value.Equals("DDR", StringComparison.OrdinalIgnoreCase)
            ? "unknown"
            : value;
}