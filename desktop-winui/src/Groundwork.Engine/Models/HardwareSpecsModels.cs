using System;
using System.Collections.Generic;

namespace Groundwork.Engine.Models;

public sealed class CpuSpecsInfo
{
    public string Name { get; set; } = string.Empty;
    public string Manufacturer { get; set; } = string.Empty;
    public int PhysicalCores { get; set; }
    public int LogicalProcessors { get; set; }
    public uint MaxClockSpeedMHz { get; set; }
    public string Socket { get; set; } = string.Empty;
    public uint L2CacheKB { get; set; }
    public uint L3CacheKB { get; set; }
    public string Architecture { get; set; } = string.Empty;
    public bool? VirtualizationEnabled { get; set; }

    public CpuSpecsInfo() { }
    public CpuSpecsInfo(string Name, string Manufacturer, int PhysicalCores, int LogicalProcessors, uint MaxClockSpeedMHz, string Socket, uint L2CacheKB, uint L3CacheKB, string Architecture, bool? VirtualizationEnabled)
    {
        this.Name = Name;
        this.Manufacturer = Manufacturer;
        this.PhysicalCores = PhysicalCores;
        this.LogicalProcessors = LogicalProcessors;
        this.MaxClockSpeedMHz = MaxClockSpeedMHz;
        this.Socket = Socket;
        this.L2CacheKB = L2CacheKB;
        this.L3CacheKB = L3CacheKB;
        this.Architecture = Architecture;
        this.VirtualizationEnabled = VirtualizationEnabled;
    }
}

public sealed class MotherboardSpecsInfo
{
    public string Manufacturer { get; set; } = string.Empty;
    public string Product { get; set; } = string.Empty;
    public string SerialNumber { get; set; } = string.Empty;
    public string Version { get; set; } = string.Empty;
    public string BiosVendor { get; set; } = string.Empty;
    public string BiosVersion { get; set; } = string.Empty;
    public string BiosReleaseDate { get; set; } = string.Empty;
    public string SmbiosVersion { get; set; } = string.Empty;
    public bool? IsSecureBootEnabled { get; set; }

    public MotherboardSpecsInfo() { }
    public MotherboardSpecsInfo(string Manufacturer, string Product, string SerialNumber, string Version, string BiosVendor, string BiosVersion, string BiosReleaseDate, string SmbiosVersion, bool? IsSecureBootEnabled)
    {
        this.Manufacturer = Manufacturer;
        this.Product = Product;
        this.SerialNumber = SerialNumber;
        this.Version = Version;
        this.BiosVendor = BiosVendor;
        this.BiosVersion = BiosVersion;
        this.BiosReleaseDate = BiosReleaseDate;
        this.SmbiosVersion = SmbiosVersion;
        this.IsSecureBootEnabled = IsSecureBootEnabled;
    }
}

public sealed class GpuSpecsInfo
{
    public string Name { get; set; } = string.Empty;
    public string DriverVersion { get; set; } = string.Empty;
    public string DriverDate { get; set; } = string.Empty;
    public long DedicatedMemoryBytes { get; set; }
    public string FormattedDedicatedMemory { get; set; } = string.Empty;
    public string ResolutionAndRefreshRate { get; set; } = string.Empty;
    public string VideoProcessor { get; set; } = string.Empty;
    public bool IsPrimary { get; set; }

    public GpuSpecsInfo() { }
    public GpuSpecsInfo(string Name, string DriverVersion, string DriverDate, long DedicatedMemoryBytes, string FormattedDedicatedMemory, string ResolutionAndRefreshRate, string VideoProcessor, bool IsPrimary)
    {
        this.Name = Name;
        this.DriverVersion = DriverVersion;
        this.DriverDate = DriverDate;
        this.DedicatedMemoryBytes = DedicatedMemoryBytes;
        this.FormattedDedicatedMemory = FormattedDedicatedMemory;
        this.ResolutionAndRefreshRate = ResolutionAndRefreshRate;
        this.VideoProcessor = VideoProcessor;
        this.IsPrimary = IsPrimary;
    }
}

public sealed class MemoryModuleInfo
{
    public string BankLocator { get; set; } = string.Empty;
    public long CapacityBytes { get; set; }
    public string FormattedCapacity { get; set; } = string.Empty;
    public uint SpeedMHz { get; set; }
    public string FormattedSpeed => SpeedMHz > 0 ? $"{SpeedMHz} MHz" : "Unknown";
    public string Manufacturer { get; set; } = string.Empty;
    public string PartNumber { get; set; } = string.Empty;
    public string FormFactor { get; set; } = string.Empty;
    public string MemoryType { get; set; } = string.Empty;

    public MemoryModuleInfo() { }
    public MemoryModuleInfo(string BankLocator, long CapacityBytes, string FormattedCapacity, uint SpeedMHz, string Manufacturer, string PartNumber, string FormFactor, string MemoryType)
    {
        this.BankLocator = BankLocator;
        this.CapacityBytes = CapacityBytes;
        this.FormattedCapacity = FormattedCapacity;
        this.SpeedMHz = SpeedMHz;
        this.Manufacturer = Manufacturer;
        this.PartNumber = PartNumber;
        this.FormFactor = FormFactor;
        this.MemoryType = MemoryType;
    }
}

public sealed class MemorySpecsSummary
{
    public long TotalPhysicalBytes { get; set; }
    public long AvailablePhysicalBytes { get; set; }
    public long UsedPhysicalBytes { get; set; }
    public string FormattedTotal { get; set; } = string.Empty;
    public string FormattedAvailable { get; set; } = string.Empty;
    public string FormattedUsed { get; set; } = string.Empty;
    public double UsedPercent { get; set; }
    public uint ConfiguredSpeedMHz { get; set; }
    public string MemoryType { get; set; } = string.Empty;
    public int TotalSlots { get; set; }
    public int PopulatedSlots { get; set; }
    public IReadOnlyList<MemoryModuleInfo> Modules { get; set; } = Array.Empty<MemoryModuleInfo>();

    public MemorySpecsSummary() { }
    public MemorySpecsSummary(long TotalPhysicalBytes, long AvailablePhysicalBytes, long UsedPhysicalBytes, string FormattedTotal, string FormattedAvailable, string FormattedUsed, double UsedPercent, uint ConfiguredSpeedMHz, string MemoryType, int TotalSlots, int PopulatedSlots, IReadOnlyList<MemoryModuleInfo> Modules)
    {
        this.TotalPhysicalBytes = TotalPhysicalBytes;
        this.AvailablePhysicalBytes = AvailablePhysicalBytes;
        this.UsedPhysicalBytes = UsedPhysicalBytes;
        this.FormattedTotal = FormattedTotal;
        this.FormattedAvailable = FormattedAvailable;
        this.FormattedUsed = FormattedUsed;
        this.UsedPercent = UsedPercent;
        this.ConfiguredSpeedMHz = ConfiguredSpeedMHz;
        this.MemoryType = MemoryType;
        this.TotalSlots = TotalSlots;
        this.PopulatedSlots = PopulatedSlots;
        this.Modules = Modules;
    }
}

public sealed class PhysicalDiskSpecsInfo
{
    public string Model { get; set; } = string.Empty;
    public string InterfaceType { get; set; } = string.Empty;
    public string MediaType { get; set; } = string.Empty;
    public long SizeBytes { get; set; }
    public string FormattedSize { get; set; } = string.Empty;
    public string SerialNumber { get; set; } = string.Empty;
    public int PartitionsCount { get; set; }
    public string Status { get; set; } = string.Empty;
    public string AssociatedVolumes { get; set; } = string.Empty;

    public PhysicalDiskSpecsInfo() { }
    public PhysicalDiskSpecsInfo(string Model, string InterfaceType, string MediaType, long SizeBytes, string FormattedSize, string SerialNumber, int PartitionsCount, string Status, string AssociatedVolumes)
    {
        this.Model = Model;
        this.InterfaceType = InterfaceType;
        this.MediaType = MediaType;
        this.SizeBytes = SizeBytes;
        this.FormattedSize = FormattedSize;
        this.SerialNumber = SerialNumber;
        this.PartitionsCount = PartitionsCount;
        this.Status = Status;
        this.AssociatedVolumes = AssociatedVolumes;
    }
}

public sealed class OsSpecsInfo
{
    public string Caption { get; set; } = string.Empty;
    public string Version { get; set; } = string.Empty;
    public string BuildNumber { get; set; } = string.Empty;
    public string Architecture { get; set; } = string.Empty;
    public string ComputerName { get; set; } = string.Empty;
    public string RegisteredUser { get; set; } = string.Empty;
    public string InstallDate { get; set; } = string.Empty;
    public TimeSpan Uptime { get; set; }
    public string FormattedUptime { get; set; } = string.Empty;

    public OsSpecsInfo() { }
    public OsSpecsInfo(string Caption, string Version, string BuildNumber, string Architecture, string ComputerName, string RegisteredUser, string InstallDate, TimeSpan Uptime, string FormattedUptime)
    {
        this.Caption = Caption;
        this.Version = Version;
        this.BuildNumber = BuildNumber;
        this.Architecture = Architecture;
        this.ComputerName = ComputerName;
        this.RegisteredUser = RegisteredUser;
        this.InstallDate = InstallDate;
        this.Uptime = Uptime;
        this.FormattedUptime = FormattedUptime;
    }
}

public sealed class NetworkAdapterSpecsInfo
{
    public string Name { get; set; } = string.Empty;
    public string AdapterType { get; set; } = string.Empty;
    public long SpeedBitsPerSecond { get; set; }
    public string FormattedSpeed { get; set; } = string.Empty;
    public string MacAddress { get; set; } = string.Empty;
    public string Status { get; set; } = string.Empty;
    public string DriverVersion { get; set; } = string.Empty;

    public NetworkAdapterSpecsInfo() { }
    public NetworkAdapterSpecsInfo(string Name, string AdapterType, long SpeedBitsPerSecond, string FormattedSpeed, string MacAddress, string Status, string DriverVersion)
    {
        this.Name = Name;
        this.AdapterType = AdapterType;
        this.SpeedBitsPerSecond = SpeedBitsPerSecond;
        this.FormattedSpeed = FormattedSpeed;
        this.MacAddress = MacAddress;
        this.Status = Status;
        this.DriverVersion = DriverVersion;
    }
}

public sealed class DriverSpecsInfo
{
    public string DeviceName { get; set; } = string.Empty;
    public string Manufacturer { get; set; } = string.Empty;
    public string DriverVersion { get; set; } = string.Empty;
    public string DriverDate { get; set; } = string.Empty;
    public string DeviceClass { get; set; } = string.Empty;
    public bool IsSigned { get; set; }

    public DriverSpecsInfo() { }
    public DriverSpecsInfo(string DeviceName, string Manufacturer, string DriverVersion, string DriverDate, string DeviceClass, bool IsSigned)
    {
        this.DeviceName = DeviceName;
        this.Manufacturer = Manufacturer;
        this.DriverVersion = DriverVersion;
        this.DriverDate = DriverDate;
        this.DeviceClass = DeviceClass;
        this.IsSigned = IsSigned;
    }
}

public sealed class HardwareSystemReport
{
    public CpuSpecsInfo Cpu { get; set; } = new();
    public MotherboardSpecsInfo Motherboard { get; set; } = new();
    public IReadOnlyList<GpuSpecsInfo> Gpus { get; set; } = Array.Empty<GpuSpecsInfo>();
    public MemorySpecsSummary Memory { get; set; } = new();
    public IReadOnlyList<PhysicalDiskSpecsInfo> Disks { get; set; } = Array.Empty<PhysicalDiskSpecsInfo>();
    public OsSpecsInfo Os { get; set; } = new();
    public IReadOnlyList<NetworkAdapterSpecsInfo> NetworkAdapters { get; set; } = Array.Empty<NetworkAdapterSpecsInfo>();
    public IReadOnlyList<DriverSpecsInfo> TopDrivers { get; set; } = Array.Empty<DriverSpecsInfo>();
    public LiveSystemDiagnosticsInfo LiveDiagnostics { get; set; } = new();
    public DateTime ReportGeneratedUtc { get; set; } = DateTime.UtcNow;

    public HardwareSystemReport() { }
    public HardwareSystemReport(CpuSpecsInfo Cpu, MotherboardSpecsInfo Motherboard, IReadOnlyList<GpuSpecsInfo> Gpus, MemorySpecsSummary Memory, IReadOnlyList<PhysicalDiskSpecsInfo> Disks, OsSpecsInfo Os, IReadOnlyList<NetworkAdapterSpecsInfo> NetworkAdapters, IReadOnlyList<DriverSpecsInfo> TopDrivers, DateTime ReportGeneratedUtc)
    {
        this.Cpu = Cpu;
        this.Motherboard = Motherboard;
        this.Gpus = Gpus;
        this.Memory = Memory;
        this.Disks = Disks;
        this.Os = Os;
        this.NetworkAdapters = NetworkAdapters;
        this.TopDrivers = TopDrivers;
        this.ReportGeneratedUtc = ReportGeneratedUtc;
    }
}

public sealed class LiveSystemDiagnosticsInfo
{
    public DateTime CollectedUtc { get; set; }
    public double? CpuUtilizationPercent { get; set; }
    public long? AvailableMemoryBytes { get; set; }
    public double? GpuEngineUtilizationPercent { get; set; }
    public long? DiskReadBytesPerSecond { get; set; }
    public long? DiskWriteBytesPerSecond { get; set; }
    public string Direct3DFeatureLevel { get; set; } = "Unknown";
    public bool? RestartPending { get; set; }
    public IReadOnlyList<string> DeviceErrors { get; set; } = Array.Empty<string>();
    public IReadOnlyList<string> CollectionWarnings { get; set; } = Array.Empty<string>();
}
