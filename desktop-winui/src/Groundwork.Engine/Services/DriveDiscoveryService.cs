using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using Groundwork.Engine.Models;

namespace Groundwork.Engine.Services;

public static class FileCategoryClassifier
{
    private static readonly Dictionary<string, (string Key, string Label)> ExtensionMap = new(StringComparer.OrdinalIgnoreCase)
    {
        // Code & Scripts
        [".cs"] = ("code", "Code & Scripts"),
        [".py"] = ("code", "Code & Scripts"),
        [".ts"] = ("code", "Code & Scripts"),
        [".tsx"] = ("code", "Code & Scripts"),
        [".js"] = ("code", "Code & Scripts"),
        [".jsx"] = ("code", "Code & Scripts"),
        [".rs"] = ("code", "Code & Scripts"),
        [".go"] = ("code", "Code & Scripts"),
        [".cpp"] = ("code", "Code & Scripts"),
        [".c"] = ("code", "Code & Scripts"),
        [".h"] = ("code", "Code & Scripts"),
        [".java"] = ("code", "Code & Scripts"),
        [".ps1"] = ("code", "Code & Scripts"),
        [".sh"] = ("code", "Code & Scripts"),
        [".sql"] = ("code", "Code & Scripts"),
        [".html"] = ("code", "Code & Scripts"),
        [".css"] = ("code", "Code & Scripts"),

        // Documents & Notes
        [".pdf"] = ("documents", "Documents & Notes"),
        [".md"] = ("documents", "Documents & Notes"),
        [".txt"] = ("documents", "Documents & Notes"),
        [".doc"] = ("documents", "Documents & Notes"),
        [".docx"] = ("documents", "Documents & Notes"),
        [".xls"] = ("documents", "Documents & Notes"),
        [".xlsx"] = ("documents", "Documents & Notes"),
        [".ppt"] = ("documents", "Documents & Notes"),
        [".pptx"] = ("documents", "Documents & Notes"),
        [".rtf"] = ("documents", "Documents & Notes"),

        // Media (Video / Audio / Images)
        [".mp4"] = ("media", "Videos, Audio & Images"),
        [".mkv"] = ("media", "Videos, Audio & Images"),
        [".mov"] = ("media", "Videos, Audio & Images"),
        [".avi"] = ("media", "Videos, Audio & Images"),
        [".webm"] = ("media", "Videos, Audio & Images"),
        [".mp3"] = ("media", "Videos, Audio & Images"),
        [".wav"] = ("media", "Videos, Audio & Images"),
        [".flac"] = ("media", "Videos, Audio & Images"),
        [".png"] = ("media", "Videos, Audio & Images"),
        [".jpg"] = ("media", "Videos, Audio & Images"),
        [".jpeg"] = ("media", "Videos, Audio & Images"),
        [".gif"] = ("media", "Videos, Audio & Images"),
        [".webp"] = ("media", "Videos, Audio & Images"),
        [".svg"] = ("media", "Videos, Audio & Images"),

        // Archives & Installers
        [".zip"] = ("archives", "Installers & Archives"),
        [".7z"] = ("archives", "Installers & Archives"),
        [".rar"] = ("archives", "Installers & Archives"),
        [".tar"] = ("archives", "Installers & Archives"),
        [".gz"] = ("archives", "Installers & Archives"),
        [".tgz"] = ("archives", "Installers & Archives"),
        [".xz"] = ("archives", "Installers & Archives"),
        [".iso"] = ("archives", "Installers & Archives"),
        [".img"] = ("archives", "Installers & Archives"),
        [".msi"] = ("archives", "Installers & Archives"),
        [".exe"] = ("archives", "Installers & Archives"),

        // Data & Models
        [".db"] = ("data", "Databases, Models & Data"),
        [".sqlite"] = ("data", "Databases, Models & Data"),
        [".sqlite3"] = ("data", "Databases, Models & Data"),
        [".csv"] = ("data", "Databases, Models & Data"),
        [".parquet"] = ("data", "Databases, Models & Data"),
        [".json"] = ("data", "Databases, Models & Data"),
        [".onnx"] = ("data", "Databases, Models & Data"),
        [".gguf"] = ("data", "Databases, Models & Data"),
        [".bin"] = ("data", "Databases, Models & Data"),
        [".safetensors"] = ("data", "Databases, Models & Data"),
    };

    public static readonly IReadOnlyDictionary<string, string> CategoryLabels = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase)
    {
        ["code"] = "Code & Scripts",
        ["documents"] = "Documents & Notes",
        ["media"] = "Videos, Audio & Images",
        ["archives"] = "Installers & Archives",
        ["data"] = "Databases, Models & Data",
        ["other"] = "Other Files"
    };

    public static string ClassifyExtension(string extension)
    {
        if (string.IsNullOrEmpty(extension))
        {
            return "other";
        }
        return ExtensionMap.TryGetValue(extension, out var match) ? match.Key : "other";
    }
}

public sealed class DriveDiscoveryService
{
    /// <summary>
    /// Automatically discovers mounted Windows drives and volumes without requiring manual folder setup.
    /// </summary>
    public IReadOnlyList<VolumeMetadata> DiscoverVolumes()
    {
        var results = new List<VolumeMetadata>();
        foreach (var drive in DriveInfo.GetDrives())
        {
            try
            {
                bool isReady = drive.IsReady;
                string root = drive.RootDirectory.FullName;
                string driveType = drive.DriveType.ToString();
                if (!isReady)
                {
                    results.Add(new VolumeMetadata(
                        RootPath: root,
                        VolumeName: root.TrimEnd('\\'),
                        FileSystem: "Offline",
                        DriveType: driveType,
                        TotalBytes: 0,
                        UsedBytes: 0,
                        FreeBytes: 0,
                        UsedPercent: 0,
                        IsReady: false,
                        SupportsUsnMftScan: false
                    ));
                    continue;
                }

                long total = Math.Max(0, drive.TotalSize);
                long free = Math.Max(0, drive.AvailableFreeSpace);
                long used = Math.Max(0, total - free);
                double pct = total > 0 ? Math.Round((double)used / total * 100.0, 1) : 0.0;
                string fs = drive.DriveFormat ?? "Unknown";
                string driveLetter = root.TrimEnd('\\');
                string systemDrive = Path.GetPathRoot(Environment.SystemDirectory)?.TrimEnd('\\') ?? "C:";
                bool isSystem = string.Equals(driveLetter, systemDrive, StringComparison.OrdinalIgnoreCase);

                string label;
                if (!string.IsNullOrWhiteSpace(drive.VolumeLabel))
                {
                    label = $"{drive.VolumeLabel} ({driveLetter})";
                }
                else if (isSystem)
                {
                    label = $"Windows ({driveLetter})";
                }
                else if (drive.DriveType == DriveType.Removable)
                {
                    label = $"USB Drive ({driveLetter})";
                }
                else if (drive.DriveType == DriveType.Network)
                {
                    label = $"Network Drive ({driveLetter})";
                }
                else
                {
                    label = $"Local Disk ({driveLetter})";
                }
                bool supportsMft = string.Equals(fs, "NTFS", StringComparison.OrdinalIgnoreCase)
                                   && drive.DriveType == DriveType.Fixed;

                results.Add(new VolumeMetadata(
                    RootPath: root,
                    VolumeName: label,
                    FileSystem: fs,
                    DriveType: driveType,
                    TotalBytes: total,
                    UsedBytes: used,
                    FreeBytes: free,
                    UsedPercent: pct,
                    IsReady: true,
                    SupportsUsnMftScan: supportsMft
                ));
            }
            catch
            {
                // Skip inaccessible transient volumes
            }
        }
        return results.OrderBy(v => v.RootPath, StringComparer.OrdinalIgnoreCase).ToList();
    }
}
