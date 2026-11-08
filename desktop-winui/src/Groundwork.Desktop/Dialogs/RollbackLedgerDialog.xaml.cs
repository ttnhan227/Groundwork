using System;
using System.Linq;
using Groundwork.Desktop.Services;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;

namespace Groundwork.Desktop.Dialogs;

public sealed partial class RollbackLedgerDialog : ContentDialog
{
    public RollbackLedgerDialog()
    {
        this.InitializeComponent();
        LoadHistory();
    }

    private void LoadHistory()
    {
        AppServices.Instance.RefreshOperationHistory();
        var rows = AppServices.Instance.OperationHistoryRows;
        LedgerListView.ItemsSource = rows;

        bool hasItems = rows.Count > 0;
        EmptyHistoryCard.Visibility = hasItems ? Visibility.Collapsed : Visibility.Visible;
        LedgerListView.Visibility = hasItems ? Visibility.Visible : Visibility.Collapsed;
    }

    private async void OnRollbackItemClick(object sender, RoutedEventArgs e)
    {
        if (sender is Button btn && btn.Tag is string executionId && !string.IsNullOrEmpty(executionId))
        {
            btn.IsEnabled = false;
            try
            {
                var result = await AppServices.Instance.SafeOperationEngine.RollbackOperationAsync(executionId);
                if (result.Succeeded)
                {
                    AppServices.Instance.RefreshOperationHistory();
                    LoadHistory();
                }
                else
                {
                    await AppServices.Instance.ShowDialogAsync("Rollback Failed", result.StatusMessage ?? "Operation could not be reversed.");
                }
            }
            catch (Exception ex)
            {
                await AppServices.Instance.ShowDialogAsync("Rollback Error", ex.Message);
            }
            finally
            {
                btn.IsEnabled = true;
            }
        }
    }
}
