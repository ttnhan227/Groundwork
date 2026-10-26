using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using Groundwork.Engine.Models;

namespace Groundwork.Engine.Services;

public static class CsvStorageReader
{
    public static DriveScanResult LoadFromCsv(string csvFilePath)
    {
        if (!File.Exists(csvFilePath))
        {
            throw new FileNotFoundException("CSV file not found.", csvFilePath);
        }

        var sw = System.Diagnostics.Stopwatch.StartNew();
        var allEntries = new List<ScannedEntry>();
        var allFolders = new List<ScannedEntry>();
        var largestFiles = new PriorityQueue<ScannedEntry, long>();
        var categoryMap = new Dictionary<string, (long Count, long Bytes)>(StringComparer.OrdinalIgnoreCase);

        long totalLogical = 0;
        long totalAllocated = 0;
        long totalFiles = 0;
        long totalFolders = 0;
        string detectedRoot = string.Empty;

        var folderPathToId = new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase);
        int nextId = 1;

        using var reader = new StreamReader(csvFilePath);
        string? header = reader.ReadLine(); // Read header line

        string? line;
        while ((line = reader.ReadLine()) != null)
        {
            if (string.IsNullOrWhiteSpace(line)) continue;

            var fields = ParseCsvLine(line);
            if (fields.Count < 2) continue;

            string fullPath = fields[0].Trim().Trim('"');
            if (string.IsNullOrEmpty(fullPath)) continue;

            if (string.IsNullOrEmpty(detectedRoot))
            {
                detectedRoot = Path.GetPathRoot(fullPath) ?? fullPath;
            }

            long sizeBytes = 0;
            if (fields.Count > 1 && long.TryParse(fields[1], out long s))
            {
                sizeBytes = s;
            }

            long allocatedBytes = sizeBytes;
            if (fields.Count > 2 && long.TryParse(fields[2], out long a) && a >= 0)
            {
                allocatedBytes = a;
            }

            long lastWrite = DateTimeOffset.UtcNow.ToUnixTimeSeconds();
            if (fields.Count > 3 && DateTime.TryParse(fields[3], CultureInfo.InvariantCulture, DateTimeStyles.AssumeLocal, out var dt))
            {
                lastWrite = new DateTimeOffset(dt).ToUnixTimeSeconds();
            }

            uint attributes = 0;
            if (fields.Count > 4)
            {
                if (uint.TryParse(fields[4], out uint attrVal))
                {
                    attributes = attrVal;
                }
                else if (fields[4].Contains('D', StringComparison.OrdinalIgnoreCase))
                {
                    attributes = 0x10; // Directory
                }
            }

            int recFiles = 0;
            if (fields.Count > 5 && int.TryParse(fields[5], out int rf))
            {
                recFiles = rf;
            }

            int recFolders = 0;
            if (fields.Count > 6 && int.TryParse(fields[6], out int rfd))
            {
                recFolders = rfd;
            }

            bool isDir = (attributes & 0x10) != 0 || recFiles > 0 || recFolders > 0 || Directory.Exists(fullPath);
            string name = Path.GetFileName(fullPath);
            if (string.IsNullOrEmpty(name))
            {
                name = fullPath;
            }

            string ext = isDir ? string.Empty : Path.GetExtension(fullPath).ToLowerInvariant();
            string category = Categorize(ext, isDir);

            int entryId = nextId++;
            string? parentDir = Path.GetDirectoryName(fullPath);
            int parentId = 0;
            if (!string.IsNullOrEmpty(parentDir) && folderPathToId.TryGetValue(parentDir, out int pId))
            {
                parentId = pId;
            }

            if (isDir)
            {
                folderPathToId[fullPath] = entryId;
                totalFolders++;
            }
            else
            {
                totalFiles++;
                totalLogical += sizeBytes;
                totalAllocated += allocatedBytes;

                if (!categoryMap.TryGetValue(category, out var catData))
                {
                    catData = (0, 0);
                }
                categoryMap[category] = (catData.Count + 1, catData.Bytes + sizeBytes);
            }

            var entry = new ScannedEntry(
                Id: entryId,
                ParentId: parentId,
                Name: name,
                FullPath: fullPath,
                Extension: ext,
                Category: category,
                IsDirectory: isDir,
                LogicalBytes: sizeBytes,
                AllocatedBytes: allocatedBytes,
                RecursiveFileCount: recFiles,
                RecursiveFolderCount: recFolders,
                LastWriteUnixSeconds: lastWrite,
                FileAttributes: attributes
            );

            allEntries.Add(entry);
            if (isDir)
            {
                allFolders.Add(entry);
            }
            else
            {
                if (largestFiles.Count < 200)
                {
                    largestFiles.Enqueue(entry, entry.LogicalBytes);
                }
                else if (largestFiles.Count > 0 && entry.LogicalBytes > largestFiles.Peek().LogicalBytes)
                {
                    largestFiles.Dequeue();
                    largestFiles.Enqueue(entry, entry.LogicalBytes);
                }
            }
        }

        var topFiles = new List<ScannedEntry>(largestFiles.Count);
        while (largestFiles.Count > 0)
        {
            topFiles.Add(largestFiles.Dequeue());
        }
        topFiles.Reverse();

        var breakdown = categoryMap
            .OrderByDescending(kv => kv.Value.Bytes)
            .Take(8)
            .Select(kv => new CategorySummary(
                Key: kv.Key.ToLowerInvariant(),
                Label: kv.Key,
                FileCount: kv.Value.Count,
                TotalBytes: kv.Value.Bytes,
                SharePercent: totalLogical > 0 ? (double)kv.Value.Bytes / totalLogical * 100.0 : 0.0
            ))
            .ToList();

        sw.Stop();

        return new DriveScanResult(
            RootPath: string.IsNullOrEmpty(detectedRoot) ? Path.GetFileName(csvFilePath) : detectedRoot,
            EngineUsed: ScanEngineMode.StandardWin32,
            TotalFiles: totalFiles,
            TotalFolders: totalFolders,
            TotalLogicalBytes: totalLogical,
            TotalAllocatedBytes: totalAllocated,
            ElapsedMilliseconds: sw.Elapsed.TotalMilliseconds,
            AccessDeniedPaths: Array.Empty<string>(),
            LargestFiles: topFiles,
            LargestFolders: allFolders.OrderByDescending(f => f.LogicalBytes).Take(50).ToList(),
            TopLevelSpaceMap: allFolders.Where(f => f.ParentId <= 0).OrderByDescending(f => f.LogicalBytes).Take(20).ToList(),
            CategoryBreakdown: breakdown,
            AllEntries: allEntries,
            AllFolders: allFolders
        );
    }

    private static List<string> ParseCsvLine(string line)
    {
        var fields = new List<string>();
        bool inQuotes = false;
        int start = 0;

        for (int i = 0; i < line.Length; i++)
        {
            char c = line[i];
            if (c == '"')
            {
                inQuotes = !inQuotes;
            }
            else if (c == ',' && !inQuotes)
            {
                fields.Add(line.Substring(start, i - start));
                start = i + 1;
            }
        }

        if (start <= line.Length)
        {
            fields.Add(line.Substring(start));
        }

        return fields;
    }

    private static string Categorize(string ext, bool isDir)
    {
        if (isDir) return "Folders";
        return ext switch
        {
            ".exe" or ".dll" or ".msi" or ".sys" or ".bat" or ".cmd" or ".ps1" => "Executable",
            ".mp4" or ".mkv" or ".avi" or ".mov" or ".wmv" or ".flv" => "Video",
            ".mp3" or ".wav" or ".flac" or ".m4a" or ".aac" or ".ogg" => "Audio",
            ".jpg" or ".jpeg" or ".png" or ".gif" or ".bmp" or ".webp" or ".svg" => "Image",
            ".zip" or ".rar" or ".7z" or ".tar" or ".gz" or ".iso" => "Archive",
            ".pdf" or ".doc" or ".docx" or ".xls" or ".xlsx" or ".ppt" or ".pptx" or ".txt" or ".md" => "Document",
            ".cs" or ".rs" or ".py" or ".js" or ".ts" or ".html" or ".css" or ".json" or ".xml" or ".cpp" => "Code",
            _ => "Other"
        };
    }
}
