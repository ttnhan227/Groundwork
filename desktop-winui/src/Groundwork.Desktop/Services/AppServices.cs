using System;
using System.Collections.Generic;
using System.Collections.ObjectModel;
using System.IO;
using System.Linq;
using System.Runtime.InteropServices;
using System.Threading.Tasks;
using Groundwork.Engine.Models;
using Groundwork.Engine.Services;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;

namespace Groundwork.Desktop.Services;

public sealed class AppServices
{
    private static AppServices? _instance;
    public static AppServices Instance => _instance ??= new AppServices();

    // 1. Engine Services
    public DriveDiscoveryService DriveDiscovery { get; } = new();
    public Win32StorageScanner Win32Scanner { get; } = new();
    public DuplicateEngineService DuplicateEngine { get; } = new();
    public SafeCleanupService CleanupService { get; } = new();
    public InstalledAppsEngineService InstalledAppsEngine { get; } = new();
    public HardwareSpecsEngineService HardwareEngine { get; } = new();
    public SafeOperationEngine SafeOperationEngine { get; }
    public WindowsOptimizationService OptimizationService { get; }
    public DiagnosticsAndTroubleshootingService TroubleshootingService { get; }
    public FileOrganizerService FileOrganizerService { get; }
    public ToolRegistryService ToolRegistry { get; }
    public InvestigationEngineService InvestigationEngine { get; }
    public AgentPlannerService AgentPlanner { get; }

    // 2. Shared App State & Caching
    public AppSettingsModel Settings { get; set; } = new();
    public DriveScanResult? LastScanResult { get; set; }
    public DuplicateScanReport? LastDuplicateReport { get; set; }
    public IReadOnlyList<InstalledApplicationInfo> AllInstalledApps { get; set; } = Array.Empty<InstalledApplicationInfo>();
    public HardwareSystemReport? LastHardwareReport { get; set; }
    public InvestigationReport? LastInvestigationReport { get; set; }
    public List<(string User, string Assistant)> AgentConversation { get; } = new();

    // 3. Shared Collections (Data-Bound Across Pages)
    public ObservableCollection<VolumeRowViewModel> Volumes { get; } = new();
    public ObservableCollection<OperationHistoryRowViewModel> OperationHistoryRows { get; } = new();
    public ObservableCollection<InstalledAppRowViewModel> InstalledApps { get; } = new();

    // 4. Host Window Reference
    public MainWindow? MainWindow { get; set; }
    public IntPtr WindowHandle => MainWindow != null ? WinRT.Interop.WindowNative.GetWindowHandle(MainWindow) : IntPtr.Zero;

    // 5. Events
    public event Action<string>? StatusChanged;
    public event Action? OperationHistoryChanged;

    private AppServices()
    {
        SafeOperationEngine = new SafeOperationEngine();
        OptimizationService = new WindowsOptimizationService(SafeOperationEngine);
        TroubleshootingService = new DiagnosticsAndTroubleshootingService(SafeOperationEngine);
        FileOrganizerService = new FileOrganizerService(SafeOperationEngine);
        ToolRegistry = new ToolRegistryService(
            HardwareEngine,
            DriveDiscovery,
            CleanupService,
            InstalledAppsEngine,
            OptimizationService,
            TroubleshootingService,
            FileOrganizerService);
        InvestigationEngine = new InvestigationEngineService(ToolRegistry);
        AgentPlanner = new AgentPlannerService(InvestigationEngine, ToolRegistry);

        Settings = AppSettingsService.Load();
    }

    public void NotifyStatus(string status)
    {
        StatusChanged?.Invoke(status);
    }

    public void NotifyOperationHistoryChanged()
    {
        RefreshOperationHistory();
        OperationHistoryChanged?.Invoke();
    }

    public void RefreshOperationHistory()
    {
        try
        {
            var history = SafeOperationEngine.History.LoadRecords();
            OperationHistoryRows.Clear();
            foreach (var op in history.OrderByDescending(h => h.ExecutedAtUtc))
            {
                OperationHistoryRows.Add(new OperationHistoryRowViewModel
                {
                    ExecutionId = op.ExecutionId,
                    DisplayName = op.DisplayName,
                    Category = op.Category,
                    TargetDescription = op.TargetDescription,
                    StatusMessage = op.StatusMessage,
                    VerificationSummary = op.Verification.ObservedStateSummary,
                    ExecutedAtDisplay = op.ExecutedAtDisplay,
                    StatusBadge = op.StatusBadge,
                    LedgerClassificationBadge = op.LedgerClassificationBadge,
                    ReversibilityNote = op.ReversibilityNote,
                    CanRollback = op.CanRollback
                });
            }
        }
        catch { }
    }

    public async Task ShowDialogAsync(string title, string message)
    {
        if (MainWindow?.Content?.XamlRoot == null) return;
        var dialog = new ContentDialog
        {
            Title = title,
            Content = message,
            CloseButtonText = "OK",
            XamlRoot = MainWindow.Content.XamlRoot
        };
        await dialog.ShowAsync();
    }

    public async Task<bool> ShowConfirmDialogAsync(string title, string message, string confirmText = "Confirm", string cancelText = "Cancel")
    {
        if (MainWindow?.Content?.XamlRoot == null) return false;
        var dialog = new ContentDialog
        {
            Title = title,
            Content = message,
            PrimaryButtonText = confirmText,
            CloseButtonText = cancelText,
            DefaultButton = ContentDialogButton.Primary,
            XamlRoot = MainWindow.Content.XamlRoot
        };
        var res = await dialog.ShowAsync();
        return res == ContentDialogResult.Primary;
    }
}
