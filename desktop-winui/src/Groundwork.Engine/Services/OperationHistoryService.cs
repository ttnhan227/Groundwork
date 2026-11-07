using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.Json;
using Groundwork.Engine.Models;

namespace Groundwork.Engine.Services;

/// <summary>
/// Persists a bounded local audit ledger of executed system operations, captured pre-change state,
/// verification outcomes, and rollback status.
/// </summary>
public sealed class OperationHistoryService
{
    private const int MaxHistoryRecords = 200;

    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        WriteIndented = true,
        PropertyNameCaseInsensitive = true
    };

    private readonly string _historyFilePath;
    private readonly object _syncLock = new();

    public OperationHistoryService(string? customHistoryFilePath = null)
    {
        if (!string.IsNullOrWhiteSpace(customHistoryFilePath))
        {
            _historyFilePath = customHistoryFilePath;
        }
        else
        {
            var localAppData = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
            _historyFilePath = Path.Combine(localAppData, "Groundwork", "operation-history.json");
        }
    }

    public string HistoryFilePath => _historyFilePath;

    public IReadOnlyList<OperationExecutionRecord> LoadRecords()
    {
        lock (_syncLock)
        {
            return LoadInternal();
        }
    }

    public OperationExecutionRecord? GetRecordById(string executionId)
    {
        if (string.IsNullOrWhiteSpace(executionId))
        {
            return null;
        }

        lock (_syncLock)
        {
            return LoadInternal().FirstOrDefault(r =>
                string.Equals(r.ExecutionId, executionId, StringComparison.OrdinalIgnoreCase));
        }
    }

    public void RecordExecution(OperationExecutionRecord record)
    {
        ArgumentNullException.ThrowIfNull(record);

        lock (_syncLock)
        {
            var list = LoadInternal();
            list.RemoveAll(r => string.Equals(r.ExecutionId, record.ExecutionId, StringComparison.OrdinalIgnoreCase));
            list.Insert(0, record);

            if (list.Count > MaxHistoryRecords)
            {
                list.RemoveRange(MaxHistoryRecords, list.Count - MaxHistoryRecords);
            }

            SaveInternal(list);
        }
    }

    public void UpdateRecordAfterRollback(string executionId, bool rollbackSucceeded, string rollbackMessage, DateTimeOffset rolledBackAtUtc)
    {
        if (string.IsNullOrWhiteSpace(executionId))
        {
            return;
        }

        lock (_syncLock)
        {
            var list = LoadInternal();
            for (var i = 0; i < list.Count; i++)
            {
                if (string.Equals(list[i].ExecutionId, executionId, StringComparison.OrdinalIgnoreCase))
                {
                    var current = list[i];
                    list[i] = current with
                    {
                        IsRolledBack = rollbackSucceeded,
                        CanRollback = !rollbackSucceeded && current.CanRollback,
                        RollbackStatusMessage = rollbackMessage,
                        RolledBackAtUtc = rollbackSucceeded ? rolledBackAtUtc : current.RolledBackAtUtc
                    };
                    SaveInternal(list);
                    return;
                }
            }
        }
    }

    public void ClearHistory()
    {
        lock (_syncLock)
        {
            try
            {
                if (File.Exists(_historyFilePath))
                {
                    File.Delete(_historyFilePath);
                }
            }
            catch
            {
                // Best-effort clear.
            }
        }
    }

    private List<OperationExecutionRecord> LoadInternal()
    {
        try
        {
            if (!File.Exists(_historyFilePath))
            {
                return [];
            }

            var json = File.ReadAllText(_historyFilePath);
            if (string.IsNullOrWhiteSpace(json))
            {
                return [];
            }

            return JsonSerializer.Deserialize<List<OperationExecutionRecord>>(json, JsonOptions) ?? [];
        }
        catch
        {
            return [];
        }
    }

    private void SaveInternal(List<OperationExecutionRecord> records)
    {
        try
        {
            var dir = Path.GetDirectoryName(_historyFilePath);
            if (!string.IsNullOrWhiteSpace(dir))
            {
                Directory.CreateDirectory(dir);
            }

            var tempPath = _historyFilePath + ".tmp";
            var json = JsonSerializer.Serialize(records, JsonOptions);
            File.WriteAllText(tempPath, json);
            File.Move(tempPath, _historyFilePath, overwrite: true);
        }
        catch
        {
            // Best-effort persistence.
        }
    }
}
