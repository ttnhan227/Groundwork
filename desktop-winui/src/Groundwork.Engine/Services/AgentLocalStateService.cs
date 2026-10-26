using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.Json;
using Groundwork.Engine.Models;

namespace Groundwork.Engine.Services;

public sealed record AgentConversationTurn(string User, string Assistant);

public static class AgentLocalStateService
{
    private static readonly JsonSerializerOptions JsonOptions = new() { WriteIndented = true };

    public static string InventoryPath => Path.Combine(GetDataDirectory(), "agent-inventory.json");
    public static string ConversationPath => Path.Combine(GetDataDirectory(), "agent-conversation.json");

    public static HardwareSystemReport? LoadInventory(string? path = null)
    {
        try
        {
            string filePath = path ?? InventoryPath;
            if (!File.Exists(filePath)) return null;
            return JsonSerializer.Deserialize<HardwareSystemReport>(File.ReadAllText(filePath));
        }
        catch
        {
            return null;
        }
    }

    public static bool SaveInventory(HardwareSystemReport report, string? path = null)
    {
        ArgumentNullException.ThrowIfNull(report);
        try
        {
            var safeCopy = JsonSerializer.Deserialize<HardwareSystemReport>(JsonSerializer.Serialize(report));
            if (safeCopy == null) return false;

            safeCopy.Motherboard.SerialNumber = string.Empty;
            safeCopy.Os.ComputerName = string.Empty;
            safeCopy.Os.RegisteredUser = string.Empty;
            foreach (var disk in safeCopy.Disks) disk.SerialNumber = string.Empty;
            foreach (var adapter in safeCopy.NetworkAdapters) adapter.MacAddress = string.Empty;
            return WriteAtomic(path ?? InventoryPath, safeCopy);
        }
        catch
        {
            return false;
        }
    }

    public static IReadOnlyList<AgentConversationTurn> LoadConversation(string? path = null)
    {
        try
        {
            string filePath = path ?? ConversationPath;
            if (!File.Exists(filePath)) return Array.Empty<AgentConversationTurn>();
            return (JsonSerializer.Deserialize<List<AgentConversationTurn>>(File.ReadAllText(filePath)) ?? new())
                .Where(turn => turn != null)
                .TakeLast(5)
                .ToArray();
        }
        catch
        {
            return Array.Empty<AgentConversationTurn>();
        }
    }

    public static bool SaveConversation(IEnumerable<AgentConversationTurn> turns, string? path = null)
    {
        ArgumentNullException.ThrowIfNull(turns);
        try
        {
            return WriteAtomic(path ?? ConversationPath, turns.TakeLast(5).ToArray());
        }
        catch
        {
            return false;
        }
    }

    public static void ClearConversation(string? path = null)
    {
        try
        {
            string filePath = path ?? ConversationPath;
            if (File.Exists(filePath)) File.Delete(filePath);
        }
        catch { }
    }

    private static bool WriteAtomic<T>(string path, T value)
    {
        string fullPath = Path.GetFullPath(path);
        string? directory = Path.GetDirectoryName(fullPath);
        if (string.IsNullOrEmpty(directory)) return false;
        Directory.CreateDirectory(directory);
        string temporaryPath = fullPath + "." + Guid.NewGuid().ToString("N") + ".tmp";
        try
        {
            File.WriteAllText(temporaryPath, JsonSerializer.Serialize(value, JsonOptions));
            File.Move(temporaryPath, fullPath, overwrite: true);
            return true;
        }
        finally
        {
            if (File.Exists(temporaryPath)) File.Delete(temporaryPath);
        }
    }

    private static string GetDataDirectory() =>
        Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Groundwork");
}