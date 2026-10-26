using System;
using System.IO;
using System.Security.Cryptography;
using System.Text;

namespace Groundwork.Engine.Services;

public static class AppIconService
{
    private static readonly string IconCacheDir = Path.Combine(Path.GetTempPath(), "Groundwork", "AppIcons");

    static AppIconService()
    {
        try
        {
            Directory.CreateDirectory(IconCacheDir);
        }
        catch { }
    }

    public static string? ExtractAndCacheIcon(string? rawIconPath, string? installLocation)
    {
        if (!OperatingSystem.IsWindows()) return null;

        string? targetFile = ResolveTargetIconFile(rawIconPath, installLocation);
        if (string.IsNullOrEmpty(targetFile) || !File.Exists(targetFile))
        {
            return null;
        }

        try
        {
            string hash = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(targetFile.ToLowerInvariant())))[..16];
            string pngPath = Path.Combine(IconCacheDir, $"{hash}.png");
            if (File.Exists(pngPath))
            {
                return pngPath;
            }

            using var icon = System.Drawing.Icon.ExtractAssociatedIcon(targetFile);
            if (icon != null)
            {
                using var bmp = icon.ToBitmap();
                bmp.Save(pngPath, System.Drawing.Imaging.ImageFormat.Png);
                return pngPath;
            }
        }
        catch
        {
        }

        return null;
    }

    private static string? ResolveTargetIconFile(string? rawIconPath, string? installLocation)
    {
        if (!string.IsNullOrWhiteSpace(rawIconPath))
        {
            string clean = rawIconPath.Trim().Trim('"');
            int commaIdx = clean.IndexOf(',');
            if (commaIdx > 0)
            {
                clean = clean[..commaIdx].Trim().Trim('"');
            }
            if (File.Exists(clean))
            {
                return clean;
            }
        }

        if (!string.IsNullOrWhiteSpace(installLocation) && Directory.Exists(installLocation))
        {
            try
            {
                var exes = Directory.GetFiles(installLocation, "*.exe", SearchOption.TopDirectoryOnly);
                if (exes.Length > 0)
                {
                    return exes[0];
                }
            }
            catch { }
        }

        return null;
    }
}
