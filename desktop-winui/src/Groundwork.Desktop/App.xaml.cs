using System;
using System.IO;
using System.Threading.Tasks;
using Microsoft.UI.Xaml;

namespace Groundwork.Desktop;

public partial class App : Application
{
    private Window? _window;

    public App()
    {
        AppDomain.CurrentDomain.UnhandledException += (s, e) =>
        {
            try
            {
                string log = Path.Combine(Path.GetTempPath(), "groundwork-crash.log");
                File.AppendAllText(log, $"{DateTime.Now}: AppDomain Unhandled: {e.ExceptionObject}\n");
            }
            catch {}
        };
        TaskScheduler.UnobservedTaskException += (s, e) =>
        {
            try
            {
                string log = Path.Combine(Path.GetTempPath(), "groundwork-crash.log");
                File.AppendAllText(log, $"{DateTime.Now}: TaskScheduler Unobserved: {e.Exception}\n");
            }
            catch {}
        };
        this.UnhandledException += (s, e) =>
        {
            try
            {
                string log = Path.Combine(Path.GetTempPath(), "groundwork-crash.log");
                File.AppendAllText(log, $"{DateTime.Now}: XAML Unhandled: {e.Exception?.Message}\n{e.Exception?.StackTrace}\n");
                e.Handled = true;
            }
            catch {}
        };
        this.InitializeComponent();
    }

    protected override void OnLaunched(LaunchActivatedEventArgs args)
    {
        try
        {
            var mainWin = new MainWindow();
            _window = mainWin;
            _window.Activate();

            var cmdLineArgs = Environment.GetCommandLineArgs();
            foreach (var a in cmdLineArgs)
            {
                if (a.StartsWith("--tab=", StringComparison.OrdinalIgnoreCase))
                {
                    string targetTab = a.Substring("--tab=".Length).Trim();
                    mainWin.NavigateToTabFromCli(targetTab);
                }
            }
        }
        catch (Exception ex)
        {
            try
            {
                string log = Path.Combine(Path.GetTempPath(), "groundwork-crash.log");
                File.AppendAllText(log, $"{DateTime.Now}: OnLaunched Exception: {ex.Message}\n{ex.StackTrace}\n");
            }
            catch {}
            throw;
        }
    }
}
