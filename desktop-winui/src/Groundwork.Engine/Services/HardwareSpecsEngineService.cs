using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Management;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using Groundwork.Engine.Models;
using Microsoft.Win32;

namespace Groundwork.Engine.Services;

public sealed class HardwareSpecsEngineService
{
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Auto)]
    private struct MEMORYSTATUSEX
    {
        public uint dwLength;
        public uint dwMemoryLoad;
        public ulong ullTotalPhys;
        public ulong ullAvailPhys;
        public ulong ullTotalPageFile;
        public ulong ullAvailPageFile;
        public ulong ullTotalVirtual;
        public ulong ullAvailVirtual;
        public ulong ullAvailExtendedVirtual;
    }

    [DllImport("kernel32.dll", CharSet = CharSet.Auto, SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool GlobalMemoryStatusEx(ref MEMORYSTATUSEX lpBuffer);

    [DllImport("d3d11.dll", ExactSpelling = true)]
    private static extern int D3D11CreateDevice(
        IntPtr adapter,
        int driverType,
        IntPtr software,
        uint flags,
        [In] uint[] featureLevels,
        uint featureLevelCount,
        uint sdkVersion,
        out IntPtr device,
        out uint selectedFeatureLevel,
        out IntPtr immediateContext);

    public Task<HardwareSystemReport> GetHardwareReportAsync(bool maskSensitiveData = false, CancellationToken ct = default)
    {
        return Task.Run(() => GetHardwareReport(maskSensitiveData), ct);
    }

    public HardwareSystemReport GetHardwareReport(bool maskSensitiveData = false)
    {
        var cpu = FetchCpuInfo();
        var mobo = FetchMotherboardInfo(maskSensitiveData);
        var gpus = FetchGpuInfo();
        var memory = FetchMemoryInfo();
        var disks = FetchDiskInfo(maskSensitiveData);
        var os = FetchOsInfo();
        var nets = FetchNetworkAdapters(maskSensitiveData);
        var drivers = FetchTopDrivers();
        var liveDiagnostics = FetchLiveDiagnostics(memory.AvailablePhysicalBytes);

        return new HardwareSystemReport(
            Cpu: cpu,
            Motherboard: mobo,
            Gpus: gpus,
            Memory: memory,
            Disks: disks,
            Os: os,
            NetworkAdapters: nets,
            TopDrivers: drivers,
            ReportGeneratedUtc: DateTime.UtcNow
        )
        {
            LiveDiagnostics = liveDiagnostics
        };
    }

    private static LiveSystemDiagnosticsInfo FetchLiveDiagnostics(long? availableMemoryBytes)
    {
        var warnings = new List<string>();
        double? cpu = ReadPerformanceCounter(
            "Win32_PerfFormattedData_PerfOS_Processor",
            "PercentProcessorTime",
            "Name='_Total'",
            warnings);
        double? gpuEngine = ReadMaximumGpuEngineUtilization(warnings);
        double? diskRead = ReadPerformanceCounter(
            "Win32_PerfFormattedData_PerfDisk_PhysicalDisk",
            "DiskReadBytesPersec",
            "Name='_Total'",
            warnings);
        double? diskWrite = ReadPerformanceCounter(
            "Win32_PerfFormattedData_PerfDisk_PhysicalDisk",
            "DiskWriteBytesPersec",
            "Name='_Total'",
            warnings);

        var errors = new List<string>();
        try
        {
            using var searcher = new ManagementObjectSearcher(
                "SELECT Name, ConfigManagerErrorCode FROM Win32_PnPEntity WHERE ConfigManagerErrorCode IS NOT NULL AND ConfigManagerErrorCode <> 0");
            foreach (ManagementObject device in searcher.Get())
            {
                using (device)
                {
                    string name = device["Name"]?.ToString()?.Trim() ?? "Unknown device";
                    string code = device["ConfigManagerErrorCode"]?.ToString() ?? "Unknown";
                    errors.Add($"{name} (Configuration Manager code {code})");
                }
            }
        }
        catch (Exception ex)
        {
            warnings.Add($"Device error query failed: {ex.GetType().Name}");
        }

        return new LiveSystemDiagnosticsInfo
        {
            CollectedUtc = DateTime.UtcNow,
            CpuUtilizationPercent = cpu,
            AvailableMemoryBytes = availableMemoryBytes > 0 ? availableMemoryBytes : null,
            GpuEngineUtilizationPercent = gpuEngine,
            DiskReadBytesPerSecond = ToNullableLong(diskRead),
            DiskWriteBytesPerSecond = ToNullableLong(diskWrite),
            Direct3DFeatureLevel = ReadHardwareFeatureLevel(warnings),
            RestartPending = ReadRestartPending(warnings),
            DeviceErrors = errors,
            CollectionWarnings = warnings
        };
    }

    private static double? ReadPerformanceCounter(string className, string propertyName, string filter, List<string> warnings)
    {
        try
        {
            using var searcher = new ManagementObjectSearcher($"SELECT {propertyName} FROM {className} WHERE {filter}");
            foreach (ManagementObject item in searcher.Get())
            {
                using (item)
                {
                    if (double.TryParse(item[propertyName]?.ToString(), System.Globalization.NumberStyles.Float, System.Globalization.CultureInfo.InvariantCulture, out double value))
                    {
                        return value >= 0 ? value : null;
                    }
                }
            }
        }
        catch (Exception ex)
        {
            warnings.Add($"{propertyName} unavailable: {ex.GetType().Name}");
        }
        return null;
    }

    private static double? ReadMaximumGpuEngineUtilization(List<string> warnings)
    {
        try
        {
            using var searcher = new ManagementObjectSearcher(
                "SELECT UtilizationPercentage FROM Win32_PerfFormattedData_GPUPerformanceCounters_GPUEngine");
            double? maximum = null;
            foreach (ManagementObject engine in searcher.Get())
            {
                using (engine)
                {
                    if (double.TryParse(engine["UtilizationPercentage"]?.ToString(), System.Globalization.NumberStyles.Float, System.Globalization.CultureInfo.InvariantCulture, out double value))
                    {
                        maximum = Math.Max(maximum ?? 0, Math.Clamp(value, 0, 100));
                    }
                }
            }
            return maximum;
        }
        catch (Exception ex)
        {
            warnings.Add($"GPU engine utilization unavailable: {ex.GetType().Name}");
            return null;
        }
    }

    private static string ReadHardwareFeatureLevel(List<string> warnings)
    {
        IntPtr device = IntPtr.Zero;
        IntPtr context = IntPtr.Zero;
        try
        {
            uint[] levels = [0xB100, 0xB000, 0xA100, 0xA000, 0x9300, 0x9200, 0x9100];
            int result = D3D11CreateDevice(IntPtr.Zero, 1, IntPtr.Zero, 0, levels, (uint)levels.Length, 7, out device, out uint selected, out context);
            if (result < 0)
            {
                warnings.Add($"Direct3D hardware feature level unavailable (HRESULT 0x{result:X8}).");
                return "Unknown";
            }
            return selected switch
            {
                0xB100 => "11_1",
                0xB000 => "11_0",
                0xA100 => "10_1",
                0xA000 => "10_0",
                0x9300 => "9_3",
                0x9200 => "9_2",
                0x9100 => "9_1",
                _ => "Unknown"
            };
        }
        catch (Exception ex)
        {
            warnings.Add($"Direct3D hardware feature level unavailable: {ex.GetType().Name}");
            return "Unknown";
        }
        finally
        {
            if (context != IntPtr.Zero) Marshal.Release(context);
            if (device != IntPtr.Zero) Marshal.Release(device);
        }
    }

    private static bool? ReadRestartPending(List<string> warnings)
    {
        try
        {
            using var cbs = Registry.LocalMachine.OpenSubKey(@"SOFTWARE\Microsoft\Windows\CurrentVersion\Component Based Servicing\RebootPending");
            using var update = Registry.LocalMachine.OpenSubKey(@"SOFTWARE\Microsoft\Windows\CurrentVersion\WindowsUpdate\Auto Update\RebootRequired");
            using var session = Registry.LocalMachine.OpenSubKey(@"SYSTEM\CurrentControlSet\Control\Session Manager");
            return cbs != null || update != null || session?.GetValue("PendingFileRenameOperations") is string[] pending && pending.Length > 0;
        }
        catch (Exception ex)
        {
            warnings.Add($"Pending restart state unavailable: {ex.GetType().Name}");
            return null;
        }
    }

    private static long? ToNullableLong(double? value) =>
        value.HasValue && value.Value <= long.MaxValue ? (long)Math.Max(0, value.Value) : null;

    private static CpuSpecsInfo FetchCpuInfo()
    {
        string name = "Unknown Processor";
        string manufacturer = "Unknown";
        int cores = 0;
        int logical = Environment.ProcessorCount;
        uint maxClockMHz = 0;
        string socket = "N/A";
        uint l2KB = 0;
        uint l3KB = 0;
        string arch = "Unknown";
        bool? virt = null;

        try
        {
            using var searcher = new ManagementObjectSearcher("SELECT Name, Manufacturer, NumberOfCores, NumberOfLogicalProcessors, MaxClockSpeed, SocketDesignation, L2CacheSize, L3CacheSize, Architecture, VirtualizationFirmwareEnabled FROM Win32_Processor");
            foreach (ManagementObject mo in searcher.Get())
            {
                name = mo["Name"]?.ToString()?.Trim() ?? name;
                manufacturer = mo["Manufacturer"]?.ToString()?.Trim() ?? manufacturer;
                if (mo["NumberOfCores"] != null && int.TryParse(mo["NumberOfCores"].ToString(), out int c)) cores = c;
                if (mo["NumberOfLogicalProcessors"] != null && int.TryParse(mo["NumberOfLogicalProcessors"].ToString(), out int lp)) logical = lp;
                if (mo["MaxClockSpeed"] != null && uint.TryParse(mo["MaxClockSpeed"].ToString(), out uint clk)) maxClockMHz = clk;
                socket = mo["SocketDesignation"]?.ToString()?.Trim() ?? socket;
                if (mo["L2CacheSize"] != null && uint.TryParse(mo["L2CacheSize"].ToString(), out uint l2)) l2KB = l2;
                if (mo["L3CacheSize"] != null && uint.TryParse(mo["L3CacheSize"].ToString(), out uint l3)) l3KB = l3;
                if (mo["Architecture"] != null && int.TryParse(mo["Architecture"].ToString(), out int cpuArchitecture))
                {
                    arch = cpuArchitecture switch
                    {
                        0 => "x86",
                        5 => "ARM",
                        6 => "Itanium",
                        9 => "x64",
                        12 => "ARM64",
                        _ => "Unknown"
                    };
                }
                if (mo["VirtualizationFirmwareEnabled"] is bool firmwareVirtualization) virt = firmwareVirtualization;
                break;
            }
        }
        catch { }

        // Clean registry processor name fallback if WMI is truncated or has extra spaces
        try
        {
            using var key = Registry.LocalMachine.OpenSubKey(@"HARDWARE\DESCRIPTION\System\CentralProcessor\0");
            var regName = key?.GetValue("ProcessorNameString") as string;
            if (!string.IsNullOrWhiteSpace(regName))
            {
                name = System.Text.RegularExpressions.Regex.Replace(regName.Trim(), @"\s+", " ");
            }
        }
        catch { }

        return new CpuSpecsInfo(
            Name: name,
            Manufacturer: manufacturer,
            PhysicalCores: cores,
            LogicalProcessors: logical,
            MaxClockSpeedMHz: maxClockMHz,
            Socket: string.IsNullOrWhiteSpace(socket) ? "Unknown" : socket,
            L2CacheKB: l2KB,
            L3CacheKB: l3KB,
            Architecture: arch,
            VirtualizationEnabled: virt
        );
    }

    private static MotherboardSpecsInfo FetchMotherboardInfo(bool mask)
    {
        string mfg = "Unknown Manufacturer";
        string product = "Unknown Motherboard";
        string serial = "N/A";
        string version = "N/A";

        try
        {
            using var searcher = new ManagementObjectSearcher("SELECT Manufacturer, Product, SerialNumber, Version FROM Win32_BaseBoard");
            foreach (ManagementObject mo in searcher.Get())
            {
                mfg = mo["Manufacturer"]?.ToString()?.Trim() ?? mfg;
                product = mo["Product"]?.ToString()?.Trim() ?? product;
                serial = mo["SerialNumber"]?.ToString()?.Trim() ?? serial;
                version = mo["Version"]?.ToString()?.Trim() ?? version;
                break;
            }
        }
        catch { }

        string biosVendor = "Unknown Vendor";
        string biosVer = "Unknown Version";
        string biosDate = "N/A";
        string smbios = "3.x";
        bool? secureBoot = null;

        try
        {
            using var biosSearcher = new ManagementObjectSearcher("SELECT Manufacturer, SMBIOSBIOSVersion, ReleaseDate, SMBIOSMajorVersion, SMBIOSMinorVersion FROM Win32_BIOS");
            foreach (ManagementObject mo in biosSearcher.Get())
            {
                biosVendor = mo["Manufacturer"]?.ToString()?.Trim() ?? biosVendor;
                biosVer = mo["SMBIOSBIOSVersion"]?.ToString()?.Trim() ?? biosVer;
                if (mo["ReleaseDate"] != null)
                {
                    biosDate = FormatWmiDate(mo["ReleaseDate"].ToString());
                }
                if (mo["SMBIOSMajorVersion"] != null)
                {
                    smbios = $"{mo["SMBIOSMajorVersion"]}.{mo["SMBIOSMinorVersion"] ?? 0}";
                }
                break;
            }
        }
        catch { }

        try
        {
            using var sbKey = Registry.LocalMachine.OpenSubKey(@"SYSTEM\CurrentControlSet\Control\SecureBoot\State");
            if (sbKey?.GetValue("UEFISecureBootEnabled") is int val)
            {
                secureBoot = val == 1;
            }
        }
        catch { }

        if (mask && !string.IsNullOrWhiteSpace(serial) && serial.Length > 4)
        {
            serial = serial[..3] + new string('*', Math.Max(2, serial.Length - 5)) + serial[^2..];
        }

        return new MotherboardSpecsInfo(
            Manufacturer: mfg,
            Product: product,
            SerialNumber: serial,
            Version: version,
            BiosVendor: biosVendor,
            BiosVersion: biosVer,
            BiosReleaseDate: biosDate,
            SmbiosVersion: smbios,
            IsSecureBootEnabled: secureBoot
        );
    }

    private static IReadOnlyList<GpuSpecsInfo> FetchGpuInfo()
    {
        var list = new List<GpuSpecsInfo>();
        try
        {
            using var searcher = new ManagementObjectSearcher("SELECT Name, DriverVersion, DriverDate, AdapterRAM, VideoProcessor, CurrentHorizontalResolution, CurrentVerticalResolution, CurrentRefreshRate FROM Win32_VideoController");
            bool isFirst = true;
            foreach (ManagementObject mo in searcher.Get())
            {
                string name = mo["Name"]?.ToString()?.Trim() ?? "Display Adapter";
                string driverVer = mo["DriverVersion"]?.ToString()?.Trim() ?? "N/A";
                string driverDate = FormatWmiDate(mo["DriverDate"]?.ToString());
                string videoProc = mo["VideoProcessor"]?.ToString()?.Trim() ?? "N/A";

                long ramBytes = 0;
                if (mo["AdapterRAM"] != null && long.TryParse(mo["AdapterRAM"].ToString(), out long r))
                {
                    ramBytes = r;
                }

                string res = "N/A";
                if (mo["CurrentHorizontalResolution"] != null && mo["CurrentVerticalResolution"] != null)
                {
                    string refresh = mo["CurrentRefreshRate"] != null ? $" @ {mo["CurrentRefreshRate"]} Hz" : "";
                    res = $"{mo["CurrentHorizontalResolution"]} x {mo["CurrentVerticalResolution"]}{refresh}";
                }

                list.Add(new GpuSpecsInfo(
                    Name: name,
                    DriverVersion: driverVer,
                    DriverDate: driverDate,
                    DedicatedMemoryBytes: ramBytes,
                    FormattedDedicatedMemory: ramBytes > 0 ? FormatBytes(ramBytes) : "Shared System Memory",
                    ResolutionAndRefreshRate: res,
                    VideoProcessor: videoProc,
                    IsPrimary: isFirst && res != "N/A"
                ));
                isFirst = false;
            }
        }
        catch { }

        return list;
    }

    private static MemorySpecsSummary FetchMemoryInfo()
    {
        long totalPhys = 0;
        long availPhys = 0;

        try
        {
            var mem = new MEMORYSTATUSEX { dwLength = (uint)Marshal.SizeOf(typeof(MEMORYSTATUSEX)) };
            if (GlobalMemoryStatusEx(ref mem))
            {
                totalPhys = (long)mem.ullTotalPhys;
                availPhys = (long)mem.ullAvailPhys;
            }
        }
        catch { }

        long usedPhys = Math.Max(0, totalPhys - availPhys);
        double usedPct = totalPhys > 0 ? (double)usedPhys / totalPhys * 100.0 : 0.0;

        var modules = new List<MemoryModuleInfo>();
        uint configSpeed = 0;
        string memType = "Unknown";

        try
        {
            using var searcher = new ManagementObjectSearcher("SELECT Capacity, Speed, Manufacturer, PartNumber, DeviceLocator, FormFactor, MemoryType, SMBIOSMemoryType FROM Win32_PhysicalMemory");
            foreach (ManagementObject mo in searcher.Get())
            {
                long cap = 0;
                if (mo["Capacity"] != null && long.TryParse(mo["Capacity"].ToString(), out long c)) cap = c;

                uint spd = 0;
                if (mo["Speed"] != null && uint.TryParse(mo["Speed"].ToString(), out uint s)) spd = s;
                if (spd > configSpeed) configSpeed = spd;

                string mfg = mo["Manufacturer"]?.ToString()?.Trim() ?? "Unknown";
                string part = mo["PartNumber"]?.ToString()?.Trim() ?? "N/A";
                string locator = mo["DeviceLocator"]?.ToString()?.Trim() ?? $"Slot {modules.Count + 1}";

                int smbiosType = 0;
                if (mo["SMBIOSMemoryType"] != null && int.TryParse(mo["SMBIOSMemoryType"].ToString(), out int smt)) smbiosType = smt;

                string type = smbiosType switch
                {
                    24 => "DDR3",
                    26 => "DDR4",
                    30 => "LPDDR4",
                    34 => "DDR5",
                    35 => "LPDDR5",
                    _ => "Unknown"
                };
                if (type != "Unknown")
                {
                    memType = memType == "Unknown" || memType == type ? type : "Mixed";
                }

                string formFactor = mo["FormFactor"]?.ToString() switch
                {
                    "8" => "DIMM",
                    "12" => "SODIMM",
                    _ => "Unknown"
                };

                modules.Add(new MemoryModuleInfo(
                    BankLocator: locator,
                    CapacityBytes: cap,
                    FormattedCapacity: FormatBytes(cap),
                    SpeedMHz: spd,
                    Manufacturer: mfg,
                    PartNumber: part,
                    FormFactor: formFactor,
                    MemoryType: type
                ));
            }
        }
        catch { }

        int totalSlots = 0;
        try
        {
            using var slotSearcher = new ManagementObjectSearcher("SELECT MemoryDevices FROM Win32_PhysicalMemoryArray");
            foreach (ManagementObject mo in slotSearcher.Get())
            {
                if (mo["MemoryDevices"] != null && int.TryParse(mo["MemoryDevices"].ToString(), out int devCount))
                {
                    totalSlots += devCount;
                }
                break;
            }
        }
        catch { }

        return new MemorySpecsSummary(
            TotalPhysicalBytes: totalPhys,
            AvailablePhysicalBytes: availPhys,
            UsedPhysicalBytes: usedPhys,
            FormattedTotal: FormatBytes(totalPhys),
            FormattedAvailable: FormatBytes(availPhys),
            FormattedUsed: FormatBytes(usedPhys),
            UsedPercent: usedPct,
            ConfiguredSpeedMHz: configSpeed,
            MemoryType: memType,
            TotalSlots: totalSlots,
            PopulatedSlots: modules.Count,
            Modules: modules
        );
    }

    private static IReadOnlyList<PhysicalDiskSpecsInfo> FetchDiskInfo(bool mask)
    {
        var list = new List<PhysicalDiskSpecsInfo>();
        try
        {
            using var searcher = new ManagementObjectSearcher("SELECT Model, InterfaceType, Size, MediaType, SerialNumber, Partitions, Status, DeviceID FROM Win32_DiskDrive");
            foreach (ManagementObject mo in searcher.Get())
            {
                string model = mo["Model"]?.ToString()?.Trim() ?? "Unknown";
                string iface = mo["InterfaceType"]?.ToString()?.Trim() ?? "Unknown";
                string media = mo["MediaType"]?.ToString()?.Trim() ?? "Unknown";
                string serial = mo["SerialNumber"]?.ToString()?.Trim() ?? "N/A";
                string status = mo["Status"]?.ToString()?.Trim() ?? "Unknown";

                long size = 0;
                if (mo["Size"] != null && long.TryParse(mo["Size"].ToString(), out long sz)) size = sz;

                int partitions = 0;
                if (mo["Partitions"] != null && int.TryParse(mo["Partitions"].ToString(), out int p)) partitions = p;

                if (mask && !string.IsNullOrWhiteSpace(serial) && serial.Length > 4)
                {
                    serial = serial[..2] + new string('*', Math.Max(2, serial.Length - 4)) + serial[^2..];
                }

                string associatedVolumes = "Unknown";
                try
                {
                    var letters = new SortedSet<string>(StringComparer.OrdinalIgnoreCase);
                    foreach (ManagementObject partition in mo.GetRelated("Win32_DiskPartition"))
                    {
                        using (partition)
                        {
                            foreach (ManagementObject logicalDisk in partition.GetRelated("Win32_LogicalDisk"))
                            {
                                using (logicalDisk)
                                {
                                    if (logicalDisk["DeviceID"] is string deviceId && !string.IsNullOrWhiteSpace(deviceId))
                                    {
                                        letters.Add(deviceId);
                                    }
                                }
                            }
                        }
                    }
                    associatedVolumes = letters.Count > 0 ? string.Join(", ", letters) : "No drive-letter volumes reported";
                }
                catch { }

                list.Add(new PhysicalDiskSpecsInfo(
                    Model: model,
                    InterfaceType: iface,
                    MediaType: media,
                    SizeBytes: size,
                    FormattedSize: FormatBytes(size),
                    SerialNumber: serial,
                    PartitionsCount: partitions,
                    Status: status,
                    AssociatedVolumes: associatedVolumes
                ));
            }
        }
        catch { }

        return list;
    }

    private static OsSpecsInfo FetchOsInfo()
    {
        string caption = RuntimeInformation.OSDescription;
        string ver = Environment.OSVersion.Version.ToString();
        string build = Environment.OSVersion.Version.Build.ToString();
        string arch = RuntimeInformation.OSArchitecture.ToString();
        string computer = Environment.MachineName;
        string user = Environment.UserName;
        string installDate = "N/A";
        TimeSpan uptime = TimeSpan.FromMilliseconds(Environment.TickCount64);

        try
        {
            using var searcher = new ManagementObjectSearcher("SELECT Caption, Version, BuildNumber, OSArchitecture, LastBootUpTime, InstallDate, RegisteredUser FROM Win32_OperatingSystem");
            foreach (ManagementObject mo in searcher.Get())
            {
                caption = mo["Caption"]?.ToString()?.Trim() ?? caption;
                ver = mo["Version"]?.ToString()?.Trim() ?? ver;
                build = mo["BuildNumber"]?.ToString()?.Trim() ?? build;
                arch = mo["OSArchitecture"]?.ToString()?.Trim() ?? arch;
                user = mo["RegisteredUser"]?.ToString()?.Trim() ?? user;
                if (mo["InstallDate"] != null)
                {
                    installDate = FormatWmiDate(mo["InstallDate"].ToString());
                }
                if (mo["LastBootUpTime"] != null && DateTime.TryParse(mo["LastBootUpTime"].ToString(), out var bootTime))
                {
                    uptime = DateTime.Now - bootTime;
                }
                break;
            }
        }
        catch { }

        string formattedUptime = $"{uptime.Days}d {uptime.Hours}h {uptime.Minutes}m";

        return new OsSpecsInfo(
            Caption: caption,
            Version: ver,
            BuildNumber: build,
            Architecture: arch,
            ComputerName: computer,
            RegisteredUser: user,
            InstallDate: installDate,
            Uptime: uptime,
            FormattedUptime: formattedUptime
        );
    }

    private static IReadOnlyList<NetworkAdapterSpecsInfo> FetchNetworkAdapters(bool mask)
    {
        var list = new List<NetworkAdapterSpecsInfo>();
        try
        {
            using var searcher = new ManagementObjectSearcher("SELECT Name, AdapterType, Speed, MACAddress, NetConnectionStatus, PhysicalAdapter FROM Win32_NetworkAdapter WHERE NetConnectionStatus IS NOT NULL AND PhysicalAdapter = True");
            foreach (ManagementObject mo in searcher.Get())
            {
                string name = mo["Name"]?.ToString()?.Trim() ?? "Network Adapter";
                string type = mo["AdapterType"]?.ToString()?.Trim() ?? "Ethernet / Wi-Fi";
                string mac = mo["MACAddress"]?.ToString()?.Trim() ?? "N/A";

                long speed = 0;
                if (mo["Speed"] != null && long.TryParse(mo["Speed"].ToString(), out long spd)) speed = spd;

                int connStatus = 0;
                if (mo["NetConnectionStatus"] != null && int.TryParse(mo["NetConnectionStatus"].ToString(), out int cs)) connStatus = cs;

                string statusLabel = connStatus switch
                {
                    2 => "Connected",
                    0 => "Disconnected",
                    1 => "Connecting",
                    7 => "Media Disconnected",
                    _ => "Available"
                };

                string formattedSpeed = speed > 0 ? $"{speed / 1_000_000.0:F0} Mbps" : "Auto-Negotiate";

                if (mask && mac.Length > 6)
                {
                    mac = mac[..5] + ":**:**:**";
                }

                list.Add(new NetworkAdapterSpecsInfo(
                    Name: name,
                    AdapterType: type,
                    SpeedBitsPerSecond: speed,
                    FormattedSpeed: formattedSpeed,
                    MacAddress: mac,
                    Status: statusLabel,
                    DriverVersion: "Native NDIS"
                ));
            }
        }
        catch { }

        return list;
    }

    private static IReadOnlyList<DriverSpecsInfo> FetchTopDrivers()
    {
        var list = new List<DriverSpecsInfo>();
        try
        {
            var allowedClasses = new HashSet<string>(StringComparer.OrdinalIgnoreCase)
            {
                "Display", "Net", "SCSIAdapter", "Media", "System", "DiskDrive", "USB", "Bluetooth", "Processor", "Battery"
            };

            using var searcher = new ManagementObjectSearcher("SELECT DeviceName, Manufacturer, DriverVersion, DriverDate, DeviceClass, IsSigned FROM Win32_PnPSignedDriver WHERE DeviceName IS NOT NULL");
            foreach (ManagementObject mo in searcher.Get())
            {
                string devClass = mo["DeviceClass"]?.ToString()?.Trim() ?? "System";
                if (!allowedClasses.Contains(devClass)) continue;

                string devName = mo["DeviceName"]?.ToString()?.Trim() ?? "";
                if (string.IsNullOrWhiteSpace(devName)) continue;

                string mfg = mo["Manufacturer"]?.ToString()?.Trim() ?? "Microsoft";
                string ver = mo["DriverVersion"]?.ToString()?.Trim() ?? "N/A";
                string date = FormatWmiDate(mo["DriverDate"]?.ToString());
                bool isSigned = mo["IsSigned"] != null && bool.TryParse(mo["IsSigned"].ToString(), out bool s) && s;

                list.Add(new DriverSpecsInfo(
                    DeviceName: devName,
                    Manufacturer: mfg,
                    DriverVersion: ver,
                    DriverDate: date,
                    DeviceClass: devClass,
                    IsSigned: isSigned
                ));

                if (list.Count >= 75) break;
            }
        }
        catch { }

        return list;
    }

    public static string FormatBytes(long bytes)
    {
        long b = Math.Max(0, bytes);
        string[] units = ["B", "KB", "MB", "GB", "TB"];
        double val = b;
        int idx = 0;
        while (val >= 1024.0 && idx < units.Length - 1)
        {
            val /= 1024.0;
            idx++;
        }
        return idx == 0 ? $"{b:N0} B" : $"{val:F1} {units[idx]}";
    }

    private static string FormatWmiDate(string? wmiDate)
    {
        if (string.IsNullOrWhiteSpace(wmiDate)) return "N/A";
        if (wmiDate.Length >= 8 && DateTime.TryParseExact(wmiDate[..8], "yyyyMMdd", System.Globalization.CultureInfo.InvariantCulture, System.Globalization.DateTimeStyles.None, out var dt))
        {
            return dt.ToString("yyyy-MM-dd");
        }
        if (DateTime.TryParse(wmiDate, out var generalDt))
        {
            return generalDt.ToString("yyyy-MM-dd");
        }
        return wmiDate;
    }

    public string ExportReportAsText(HardwareSystemReport report)
    {
        var sb = new StringBuilder();
        sb.AppendLine("================================================================================");
        sb.AppendLine($"GROUNDWORK SYSTEM & HARDWARE SPECIFICATIONS REPORT");
        sb.AppendLine($"Generated: {report.ReportGeneratedUtc:yyyy-MM-dd HH:mm:ss} UTC | Host: {report.Os.ComputerName}");
        sb.AppendLine("================================================================================\n");

        sb.AppendLine("[1. PROCESSOR (CPU)]");
        sb.AppendLine($"  Model:            {report.Cpu.Name}");
        sb.AppendLine($"  Manufacturer:     {report.Cpu.Manufacturer}");
        sb.AppendLine($"  Cores / Threads:  {report.Cpu.PhysicalCores} Physical Cores, {report.Cpu.LogicalProcessors} Logical Processors");
        sb.AppendLine($"  Max Clock Speed:  {report.Cpu.MaxClockSpeedMHz} MHz");
        sb.AppendLine($"  Socket / Form:    {report.Cpu.Socket}");
        sb.AppendLine($"  L2 / L3 Cache:    {report.Cpu.L2CacheKB} KB L2 / {report.Cpu.L3CacheKB} KB L3");
        sb.AppendLine($"  Architecture:     {report.Cpu.Architecture}");
        sb.AppendLine($"  Firmware Virtualization: {report.Cpu.VirtualizationEnabled?.ToString() ?? "Unknown"}\n");

        sb.AppendLine("[2. MOTHERBOARD & BIOS]");
        sb.AppendLine($"  Manufacturer:     {report.Motherboard.Manufacturer}");
        sb.AppendLine($"  Product / Model:  {report.Motherboard.Product} (Version: {report.Motherboard.Version})");
        sb.AppendLine($"  Serial Number:    {report.Motherboard.SerialNumber}");
        sb.AppendLine($"  BIOS Vendor:      {report.Motherboard.BiosVendor}");
        sb.AppendLine($"  BIOS Version:     {report.Motherboard.BiosVersion} ({report.Motherboard.BiosReleaseDate})");
        sb.AppendLine($"  SMBIOS Version:   {report.Motherboard.SmbiosVersion}");
        sb.AppendLine($"  Secure Boot:      {report.Motherboard.IsSecureBootEnabled?.ToString() ?? "Unknown"}\n");

        sb.AppendLine("[3. MEMORY (RAM)]");
        sb.AppendLine($"  Total Capacity:   {report.Memory.FormattedTotal} ({report.Memory.TotalPhysicalBytes:N0} bytes)");
        sb.AppendLine($"  In-Use Memory:    {report.Memory.FormattedUsed} ({report.Memory.UsedPercent:F1}%)");
        sb.AppendLine($"  Available Memory: {report.Memory.FormattedAvailable}");
        sb.AppendLine($"  Speed / Type:     {report.Memory.ConfiguredSpeedMHz} MHz • {report.Memory.MemoryType}");
        sb.AppendLine($"  Slots Populated:  {report.Memory.PopulatedSlots} of {report.Memory.TotalSlots} physical slots");
        foreach (var mod in report.Memory.Modules)
        {
            sb.AppendLine($"    - {mod.BankLocator}: {mod.FormattedCapacity} {mod.MemoryType}-{mod.SpeedMHz} ({mod.Manufacturer} {mod.PartNumber})");
        }
        sb.AppendLine();

        sb.AppendLine("[4. GRAPHICS (GPU)]");
        foreach (var gpu in report.Gpus)
        {
            sb.AppendLine($"  Device Name:      {gpu.Name} {(gpu.IsPrimary ? "[Primary Active Display]" : "")}");
            sb.AppendLine($"  Video Processor:  {gpu.VideoProcessor}");
            sb.AppendLine($"  Dedicated VRAM:   {gpu.FormattedDedicatedMemory}");
            sb.AppendLine($"  Driver Version:   {gpu.DriverVersion} ({gpu.DriverDate})");
            sb.AppendLine($"  Resolution:       {gpu.ResolutionAndRefreshRate}");
            sb.AppendLine();
        }

        sb.AppendLine("[5. PHYSICAL STORAGE DISKS]");
        foreach (var disk in report.Disks)
        {
            sb.AppendLine($"  Model:            {disk.Model}");
            sb.AppendLine($"  Interface / Media:{disk.InterfaceType} • {disk.MediaType}");
            sb.AppendLine($"  Capacity:         {disk.FormattedSize} ({disk.PartitionsCount} partitions)");
            sb.AppendLine($"  Serial:           {disk.SerialNumber}");
            sb.AppendLine($"  Status:           {disk.Status}");
            sb.AppendLine();
        }

        sb.AppendLine("[6. OPERATING SYSTEM]");
        sb.AppendLine($"  OS Edition:       {report.Os.Caption}");
        sb.AppendLine($"  Build & Version:  Version {report.Os.Version} (Build {report.Os.BuildNumber})");
        sb.AppendLine($"  Architecture:     {report.Os.Architecture}");
        sb.AppendLine($"  Install Date:     {report.Os.InstallDate}");
        sb.AppendLine($"  System Uptime:    {report.Os.FormattedUptime}\n");

        sb.AppendLine("[7. NETWORK CONTROLLERS]");
        foreach (var net in report.NetworkAdapters)
        {
            sb.AppendLine($"  Adapter:          {net.Name}");
            sb.AppendLine($"  Type / Speed:     {net.AdapterType} • {net.FormattedSpeed}");
            sb.AppendLine($"  Status:           {net.Status} (MAC: {net.MacAddress})");
            sb.AppendLine();
        }

        sb.AppendLine($"[8. TOP SYSTEM DRIVERS ({report.TopDrivers.Count} verified signed drivers)]");
        foreach (var drv in report.TopDrivers)
        {
            sb.AppendLine($"  [{drv.DeviceClass}] {drv.DeviceName} | {drv.Manufacturer} | v{drv.DriverVersion} ({drv.DriverDate})");
        }

        return sb.ToString();
    }

    public string ExportReportAsJson(HardwareSystemReport report)
    {
        return JsonSerializer.Serialize(report, new JsonSerializerOptions { WriteIndented = true });
    }
}
