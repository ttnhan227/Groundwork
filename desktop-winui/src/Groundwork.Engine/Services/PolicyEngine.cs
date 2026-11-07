using System;
using System.IO;
using System.Security.Principal;
using Groundwork.Engine.Models;

namespace Groundwork.Engine.Services;

/// <summary>
/// Enforces privilege checks, path boundaries, and safety policies before system operations are proposed or executed.
/// </summary>
public sealed class PolicyEngine
{
    private readonly Func<bool> _elevationCheckOverride;

    public PolicyEngine(Func<bool>? elevationCheckOverride = null)
    {
        _elevationCheckOverride = elevationCheckOverride ?? CheckCurrentProcessElevated;
    }

    public bool IsCurrentProcessElevated() => _elevationCheckOverride();

    public static bool CheckCurrentProcessElevated()
    {
        if (!OperatingSystem.IsWindows())
        {
            return false;
        }

        try
        {
            using var identity = WindowsIdentity.GetCurrent();
            var principal = new WindowsPrincipal(identity);
            return principal.IsInRole(WindowsBuiltInRole.Administrator);
        }
        catch
        {
            return false;
        }
    }

    public OperationPrerequisiteResult ValidateDescriptorPolicy(
        SystemOperationDescriptor descriptor,
        string? targetDescription,
        Func<(bool IsMet, string Reason)>? customPrerequisiteValidator = null)
    {
        ArgumentNullException.ThrowIfNull(descriptor);

        var isElevated = IsCurrentProcessElevated();
        var requiresElevation = descriptor.ElevationRequirement == OperationElevationRequirement.AdministratorRequired;

        if (requiresElevation && !isElevated)
        {
            return new OperationPrerequisiteResult(
                IsMet: false,
                Reason: $"Operation '{descriptor.DisplayName}' requires Administrator privileges. Please run Groundwork as Administrator to execute this action.",
                RequiresElevation: true,
                IsCurrentlyElevated: false);
        }

        if (string.IsNullOrWhiteSpace(targetDescription))
        {
            return new OperationPrerequisiteResult(
                IsMet: false,
                Reason: "Target description cannot be empty.",
                RequiresElevation: requiresElevation,
                IsCurrentlyElevated: isElevated);
        }

        if (customPrerequisiteValidator is not null)
        {
            var custom = customPrerequisiteValidator();
            if (!custom.IsMet)
            {
                return new OperationPrerequisiteResult(
                    IsMet: false,
                    Reason: string.IsNullOrWhiteSpace(custom.Reason) ? "Operation prerequisite check failed." : custom.Reason,
                    RequiresElevation: requiresElevation,
                    IsCurrentlyElevated: isElevated);
            }
        }

        return new OperationPrerequisiteResult(
            IsMet: true,
            Reason: "All prerequisites satisfied.",
            RequiresElevation: requiresElevation,
            IsCurrentlyElevated: isElevated);
    }

    public static bool IsProtectedSystemDirectory(string path)
    {
        if (string.IsNullOrWhiteSpace(path))
        {
            return true;
        }

        try
        {
            var full = Path.GetFullPath(path).TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);
            var root = Path.GetPathRoot(full)?.TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);
            if (!string.IsNullOrEmpty(root) && string.Equals(full, root, StringComparison.OrdinalIgnoreCase))
            {
                return true;
            }

            string[] protectedFolders =
            [
                Environment.GetFolderPath(Environment.SpecialFolder.Windows),
                Environment.GetFolderPath(Environment.SpecialFolder.System),
                Environment.GetFolderPath(Environment.SpecialFolder.SystemX86),
                Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles),
                Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86),
                Environment.GetFolderPath(Environment.SpecialFolder.UserProfile)
            ];

            foreach (var pf in protectedFolders)
            {
                if (string.IsNullOrWhiteSpace(pf))
                {
                    continue;
                }

                var normPf = Path.GetFullPath(pf).TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);
                if (string.Equals(full, normPf, StringComparison.OrdinalIgnoreCase))
                {
                    return true;
                }
            }

            var windowsDir = Environment.GetFolderPath(Environment.SpecialFolder.Windows);
            if (!string.IsNullOrWhiteSpace(windowsDir))
            {
                var normWin = Path.GetFullPath(windowsDir).TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);
                if (full.StartsWith(normWin + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase))
                {
                    // Allow Temp inside Windows if explicitly handled by cleanup, otherwise treat Windows tree as protected.
                    var winTemp = Path.Combine(normWin, "Temp");
                    if (!full.StartsWith(winTemp, StringComparison.OrdinalIgnoreCase))
                    {
                        return true;
                    }
                }
            }

            return false;
        }
        catch
        {
            return true;
        }
    }
}
