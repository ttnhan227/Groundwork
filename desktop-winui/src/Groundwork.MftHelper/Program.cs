using System;
using System.IO;
using System.IO.Pipes;
using System.Text;
using System.Text.Json;
using System.Threading.Tasks;
using Groundwork.Engine.Services;

namespace Groundwork.MftHelper;

public static class Program
{
    public static async Task<int> Main(string[] args)
    {
        string rootPath = string.Empty;
        string pipeName = string.Empty;
        int topN = 25;

        for (int i = 0; i < args.Length; i++)
        {
            if (args[i] == "--root" && i + 1 < args.Length)
            {
                rootPath = args[++i];
            }
            else if (args[i] == "--pipe" && i + 1 < args.Length)
            {
                pipeName = args[++i];
            }
            else if (args[i] == "--top" && i + 1 < args.Length && int.TryParse(args[++i], out int parsedTop))
            {
                topN = parsedTop;
            }
        }

        if (string.IsNullOrWhiteSpace(rootPath))
        {
            Console.Error.WriteLine("Usage: Groundwork.MftHelper --root <RootPath> [--pipe <PipeName>] [--top <N>]");
            return 2;
        }

        try
        {
            var scanner = new NtfsMftScanner();
            var result = await scanner.ScanWithFallbackAsync(
                rootPath: rootPath,
                requestElevationIfNeeded: false,
                topN: topN,
                retainAllEntries: false).ConfigureAwait(false);

            string json = JsonSerializer.Serialize(result);

            if (!string.IsNullOrWhiteSpace(pipeName))
            {
                using var pipeClient = new NamedPipeClientStream(".", pipeName, PipeDirection.Out, PipeOptions.Asynchronous);
                await pipeClient.ConnectAsync(15000).ConfigureAwait(false);
                using var writer = new StreamWriter(pipeClient, Encoding.UTF8);
                await writer.WriteAsync(json).ConfigureAwait(false);
                await writer.FlushAsync().ConfigureAwait(false);
            }
            else
            {
                Console.Out.WriteLine(json);
            }

            return 0;
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine($"MftHelper error: {ex.Message}");
            return 1;
        }
    }
}
