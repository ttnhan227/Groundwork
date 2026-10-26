using System;
using System.Collections.Generic;
using System.IO;
using System.Text.Json;
using System.Threading.Tasks;
using Groundwork.Engine.Models;
using Groundwork.Engine.Services;
using Xunit;
using Xunit.Abstractions;

namespace Groundwork.Engine.Tests;

public sealed class HardwareSpecsEngineTests
{
    private readonly ITestOutputHelper _output;
    private readonly HardwareSpecsEngineService _hardwareEngine;

    public HardwareSpecsEngineTests(ITestOutputHelper output)
    {
        _output = output;
        _hardwareEngine = new HardwareSpecsEngineService();
    }

    [Fact]
    public async Task GetHardwareReportAsync_ReturnsNonEmptySystemSpecs()
    {
        var report = await _hardwareEngine.GetHardwareReportAsync(maskSensitiveData: false);

        Assert.NotNull(report);
        Assert.NotNull(report.Cpu);
        Assert.False(string.IsNullOrWhiteSpace(report.Cpu.Name));
        Assert.True(report.Cpu.PhysicalCores > 0, "Cores should be > 0");
        Assert.True(report.Cpu.LogicalProcessors > 0, "Logical processors should be > 0");

        Assert.NotNull(report.Motherboard);
        Assert.False(string.IsNullOrWhiteSpace(report.Motherboard.Manufacturer));

        Assert.NotNull(report.Memory);
        Assert.True(report.Memory.TotalPhysicalBytes > 0, "Total physical RAM should be > 0");

        Assert.NotNull(report.Disks);
        Assert.NotEmpty(report.Disks);

        Assert.NotNull(report.Os);
        Assert.False(string.IsNullOrWhiteSpace(report.Os.Caption));
        Assert.NotNull(report.LiveDiagnostics);
        Assert.True(report.LiveDiagnostics.CollectedUtc <= DateTime.UtcNow);

        _output.WriteLine($"CPU: {report.Cpu.Name} ({report.Cpu.PhysicalCores}C / {report.Cpu.LogicalProcessors}T)");
        _output.WriteLine($"Mobo: {report.Motherboard.Manufacturer} - {report.Motherboard.Product}");
        _output.WriteLine($"RAM: {report.Memory.FormattedTotal} (Used: {report.Memory.FormattedUsed})");
        _output.WriteLine($"OS: {report.Os.Caption} (Build {report.Os.BuildNumber})");
    }

    [Fact]
    public async Task GetHardwareReportAsync_MasksSensitiveSerials_WhenRequested()
    {
        var maskedReport = await _hardwareEngine.GetHardwareReportAsync(maskSensitiveData: true);

        Assert.NotNull(maskedReport);
        Assert.Contains("*", maskedReport.Motherboard.SerialNumber);

        foreach (var disk in maskedReport.Disks)
        {
            if (!string.IsNullOrWhiteSpace(disk.SerialNumber) && disk.SerialNumber.Length > 4)
            {
                Assert.Contains("*", disk.SerialNumber);
            }
        }

        foreach (var net in maskedReport.NetworkAdapters)
        {
            if (!string.IsNullOrWhiteSpace(net.MacAddress) && net.MacAddress != "N/A" && net.MacAddress.Length > 6)
            {
                Assert.Contains("*", net.MacAddress);
            }
        }
    }

    [Fact]
    public async Task ExportReportAsTextAndJson_ProducesValidFormattedOutputs()
    {
        var report = await _hardwareEngine.GetHardwareReportAsync(maskSensitiveData: false);

        string text = _hardwareEngine.ExportReportAsText(report);
        Assert.Contains("GROUNDWORK SYSTEM & HARDWARE SPECIFICATIONS REPORT", text);
        Assert.Contains("PROCESSOR (CPU)", text);
        Assert.Contains("MOTHERBOARD & BIOS", text);
        Assert.Contains("MEMORY (RAM)", text);
        Assert.Contains("PHYSICAL STORAGE DISKS", text);

        string json = _hardwareEngine.ExportReportAsJson(report);
        Assert.False(string.IsNullOrWhiteSpace(json));

        using var doc = JsonDocument.Parse(json);
        var root = doc.RootElement;
        Assert.True(root.TryGetProperty("Cpu", out var cpuEl) || root.TryGetProperty("cpu", out cpuEl));
        Assert.True(root.TryGetProperty("Memory", out var memEl) || root.TryGetProperty("memory", out memEl));
    }

    [Fact]
    public void AgentSystemContextBuilder_IncludesHardwareAndFreshLogicalVolumesSeparately()
    {
        var report = new HardwareSystemReport
        {
            Cpu = new CpuSpecsInfo { Name = "Example CPU", Manufacturer = "Example", PhysicalCores = 8, LogicalProcessors = 16, Architecture = "X64" },
            Motherboard = new MotherboardSpecsInfo { Manufacturer = "Board Co", Product = "Model X" },
            Gpus = new[] { new GpuSpecsInfo { Name = "Example GPU", DriverVersion = "1.2", DedicatedMemoryBytes = 8L * 1024 * 1024 * 1024 } },
            Memory = new MemorySpecsSummary { TotalPhysicalBytes = 16L * 1024 * 1024 * 1024, AvailablePhysicalBytes = 6L * 1024 * 1024 * 1024, MemoryType = "DDR5", PopulatedSlots = 2, TotalSlots = 0 },
            Disks = new[]
            {
                new PhysicalDiskSpecsInfo { Model = "Example NVMe", SizeBytes = 1_000_000_000_000, InterfaceType = "NVMe", MediaType = "SSD", AssociatedVolumes = "C:, D:" },
                new PhysicalDiskSpecsInfo { Model = "Example SATA", SizeBytes = 2_000_000_000_000, InterfaceType = "SATA", MediaType = "HDD", AssociatedVolumes = "E:" }
            },
            Os = new OsSpecsInfo { Caption = "Windows", Version = "10.0", BuildNumber = "22631", Architecture = "64-bit" },
            LiveDiagnostics = new LiveSystemDiagnosticsInfo
            {
                CpuUtilizationPercent = 42.5,
                GpuEngineUtilizationPercent = null,
                DiskReadBytesPerSecond = 1024,
                Direct3DFeatureLevel = "11_0",
                RestartPending = false,
                CollectionWarnings = new[] { "GPU counters unavailable" }
            },
            ReportGeneratedUtc = new DateTime(2026, 10, 26, 12, 0, 0, DateTimeKind.Utc)
        };
        var volumes = new[]
        {
            new VolumeMetadata("C:\\", "Windows", "NTFS", "Fixed", 500, 300, 200, 60, true, true),
            new VolumeMetadata("D:\\", "Data", "NTFS", "Fixed", 500, 400, 100, 80, true, true)
        };

        string context = AgentSystemContextBuilder.Build(report, volumes, new DateTime(2026, 10, 26, 12, 5, 0, DateTimeKind.Utc));

        Assert.Contains("Example CPU", context);
        Assert.Contains("Example GPU", context);
        Assert.Contains("DDR5", context);
        Assert.Contains("CPU utilization: 42.5%", context);
        Assert.Contains("GPU engine utilization: unknown", context);
        Assert.Contains("D3D11 hardware feature level: 11_0", context);
        Assert.Contains("GPU counters unavailable", context);
        Assert.Contains("Example SATA", context);
        Assert.Contains("C:, D:", context);
        Assert.Contains("C:\\ (Windows)", context);
        Assert.Contains("D:\\ (Data)", context);
        Assert.Contains("not necessarily a separate physical disk", context);
        Assert.Contains("Do not infer physical disk count from drive letters", context);
        Assert.Contains("total slots: unknown", context);
    }

    [Fact]
    public void AgentSystemContextBuilder_PreservesUnknownsWhenInventoryIsPartial()
    {
        string context = AgentSystemContextBuilder.Build(null, Array.Empty<VolumeMetadata>());

        Assert.Contains("inventory: unavailable", context);
        Assert.Contains("No accessible logical volumes", context);
        Assert.Contains("M.2 slot count", context);
        Assert.Contains("temperatures and throttling are not collected", context);
    }

    [Fact]
    public void AgentSystemContextBuilder_UsesRefreshedVolumeValuesAndMarksStaleHardware()
    {
        var report = new HardwareSystemReport
        {
            ReportGeneratedUtc = new DateTime(2020, 1, 1, 0, 0, 0, DateTimeKind.Utc)
        };
        var refreshedVolume = new VolumeMetadata("C:\\", "Windows", "NTFS", "Fixed", 1000, 700, 300, 70, true, true);

        string context = AgentSystemContextBuilder.Build(report, new[] { refreshedVolume }, DateTime.UtcNow);

        Assert.Contains("cached snapshot older than five minutes", context);
        Assert.Contains("historical", context);
        Assert.Contains("unknown (no timestamp in this cached report)", context);
        Assert.Contains("300 B of 1,000 B", context);
        Assert.Contains("authoritative source was actually retrieved", context);
    }

    [Fact]
    public void AgentSystemContextBuilder_MarksContextOmittedAtTheConfiguredLimit()
    {
        string limited = AgentSystemContextBuilder.LimitContext(new string('x', 25_000), 24_000);

        Assert.Equal(24_000, limited.Length);
        Assert.EndsWith("[Remaining context omitted after the explicit character limit.]", limited);
    }

    [Fact]
    public void AgentLocalStateService_PersistsInventoryWithoutMachineIdentifiers()
    {
        string path = Path.Combine(Path.GetTempPath(), Guid.NewGuid().ToString("N"), "inventory.json");
        var report = new HardwareSystemReport
        {
            Motherboard = new MotherboardSpecsInfo { SerialNumber = "board-serial" },
            Os = new OsSpecsInfo { ComputerName = "private-host", RegisteredUser = "private-user" },
            Disks = new[] { new PhysicalDiskSpecsInfo { SerialNumber = "disk-serial" } },
            NetworkAdapters = new[] { new NetworkAdapterSpecsInfo { MacAddress = "00:11:22:33:44:55" } }
        };

        try
        {
            Assert.True(AgentLocalStateService.SaveInventory(report, path));
            var loaded = AgentLocalStateService.LoadInventory(path);

            Assert.NotNull(loaded);
            Assert.Equal("board-serial", report.Motherboard.SerialNumber);
            Assert.Empty(loaded.Motherboard.SerialNumber);
            Assert.Empty(loaded.Os.ComputerName);
            Assert.Empty(loaded.Os.RegisteredUser);
            Assert.Empty(loaded.Disks[0].SerialNumber);
            Assert.Empty(loaded.NetworkAdapters[0].MacAddress);
        }
        finally
        {
            Directory.Delete(Path.GetDirectoryName(path)!, recursive: true);
        }
    }

    [Fact]
    public void AgentLocalStateService_PersistsOnlyFiveConversationTurnsAndClearsThem()
    {
        string path = Path.Combine(Path.GetTempPath(), Guid.NewGuid().ToString("N"), "conversation.json");
        var turns = Enumerable.Range(1, 7).Select(index => new AgentConversationTurn($"q{index}", $"a{index}"));

        try
        {
            Assert.True(AgentLocalStateService.SaveConversation(turns, path));
            var loaded = AgentLocalStateService.LoadConversation(path);

            Assert.Equal(5, loaded.Count);
            Assert.Equal("q3", loaded[0].User);
            AgentLocalStateService.ClearConversation(path);
            Assert.Empty(AgentLocalStateService.LoadConversation(path));
        }
        finally
        {
            if (Directory.Exists(Path.GetDirectoryName(path)!)) Directory.Delete(Path.GetDirectoryName(path)!, recursive: true);
        }
    }
}
