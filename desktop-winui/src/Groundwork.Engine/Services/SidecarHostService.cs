using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Net;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Net.Sockets;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;

namespace Groundwork.Engine.Services;

public sealed class SidecarHostService : IAsyncDisposable
{
    private readonly HttpClient _httpClient;
    private Process? _coreProcess;
    private IntPtr _jobHandle = IntPtr.Zero;
    private string _baseUrl = string.Empty;
    private string _bearerToken = string.Empty;

    public string BaseUrl => _baseUrl;
    public bool IsRunning => _coreProcess is { HasExited: false };

    #region Win32 Job Object P/Invoke

    private enum JOBOBJECTINFOCLASS
    {
        JobObjectExtendedLimitInformation = 9
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct JOBOBJECT_BASIC_LIMIT_INFORMATION
    {
        public long PerProcessUserTimeLimit;
        public long PerJobUserTimeLimit;
        public uint LimitFlags;
        public UIntPtr MinimumWorkingSetSize;
        public UIntPtr MaximumWorkingSetSize;
        public uint ActiveProcessLimit;
        public UIntPtr Affinity;
        public uint PriorityClass;
        public uint SchedulingClass;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct IO_COUNTERS
    {
        public ulong ReadOperationCount;
        public ulong WriteOperationCount;
        public ulong OtherOperationCount;
        public ulong ReadTransferCount;
        public ulong WriteTransferCount;
        public ulong OtherTransferCount;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct JOBOBJECT_EXTENDED_LIMIT_INFORMATION
    {
        public JOBOBJECT_BASIC_LIMIT_INFORMATION BasicLimitInformation;
        public IO_COUNTERS IoInfo;
        public UIntPtr ProcessMemoryLimit;
        public UIntPtr JobMemoryLimit;
        public UIntPtr PeakProcessMemoryUsed;
        public UIntPtr PeakJobMemoryUsed;
    }

    private const uint JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE = 0x00002000;

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern IntPtr CreateJobObjectW(IntPtr lpJobAttributes, string? lpName);

    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool SetInformationJobObject(
        IntPtr hJob,
        JOBOBJECTINFOCLASS infoType,
        ref JOBOBJECT_EXTENDED_LIMIT_INFORMATION lpJobObjectInfo,
        uint cbJobObjectInfoLength);

    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool AssignProcessToJobObject(IntPtr hJob, IntPtr hProcess);

    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool CloseHandle(IntPtr hObject);

    #endregion

    public SidecarHostService(HttpClient? httpClient = null)
    {
        _httpClient = httpClient ?? new HttpClient { Timeout = TimeSpan.FromSeconds(45) };
    }

    public void ConfigureExistingEndpoint(string baseUrl, string? bearerToken = null)
    {
        _baseUrl = baseUrl.TrimEnd('/');
        _bearerToken = bearerToken ?? string.Empty;
        if (!string.IsNullOrEmpty(_bearerToken))
        {
            _httpClient.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", _bearerToken);
        }
    }

    public async Task<bool> EnsureStartedAsync(
        string? coreExecutableOrScriptDir = null,
        CancellationToken cancellationToken = default)
    {
        if (IsRunning && await CheckHealthAsync(cancellationToken).ConfigureAwait(false))
        {
            return true;
        }

        int port = FindAvailableLoopbackPort();
        _bearerToken = Convert.ToHexStringLower(RandomNumberGenerator.GetBytes(24));
        _baseUrl = $"http://127.0.0.1:{port}";
        _httpClient.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", _bearerToken);

        string dataDir = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "Groundwork");
        Directory.CreateDirectory(dataDir);

        ProcessStartInfo? psi = ResolveSidecarStartInfo(coreExecutableOrScriptDir, port, _bearerToken, dataDir);
        if (psi == null)
        {
            return false;
        }

        _coreProcess = Process.Start(psi);
        if (_coreProcess == null)
        {
            return false;
        }

        AttachToKillOnCloseJobObject(_coreProcess);

        var sw = Stopwatch.StartNew();
        while (sw.Elapsed < TimeSpan.FromSeconds(25) && !cancellationToken.IsCancellationRequested)
        {
            if (_coreProcess.HasExited)
            {
                return false;
            }
            if (await CheckHealthAsync(cancellationToken).ConfigureAwait(false))
            {
                return true;
            }
            await Task.Delay(250, cancellationToken).ConfigureAwait(false);
        }

        return false;
    }

    public async Task<bool> CheckHealthAsync(CancellationToken cancellationToken = default)
    {
        if (string.IsNullOrEmpty(_baseUrl))
        {
            return false;
        }
        try
        {
            using var resp = await _httpClient.GetAsync($"{_baseUrl}/health", cancellationToken).ConfigureAwait(false);
            return resp.IsSuccessStatusCode;
        }
        catch
        {
            return false;
        }
    }

    public async Task<JsonDocument?> GetJsonAsync(string relativePath, CancellationToken cancellationToken = default)
    {
        if (string.IsNullOrEmpty(_baseUrl))
        {
            return null;
        }
        using var resp = await _httpClient.GetAsync($"{_baseUrl}{relativePath}", cancellationToken).ConfigureAwait(false);
        resp.EnsureSuccessStatusCode();
        string body = await resp.Content.ReadAsStringAsync(cancellationToken).ConfigureAwait(false);
        return JsonDocument.Parse(body);
    }

    public async Task<JsonDocument?> PostJsonAsync(string relativePath, object payload, CancellationToken cancellationToken = default)
    {
        if (string.IsNullOrEmpty(_baseUrl))
        {
            return null;
        }
        string json = JsonSerializer.Serialize(payload);
        using var content = new StringContent(json, Encoding.UTF8, "application/json");
        using var resp = await _httpClient.PostAsync($"{_baseUrl}{relativePath}", content, cancellationToken).ConfigureAwait(false);
        resp.EnsureSuccessStatusCode();
        string body = await resp.Content.ReadAsStringAsync(cancellationToken).ConfigureAwait(false);
        return JsonDocument.Parse(body);
    }

    public async Task<JsonDocument?> PutJsonAsync(string relativePath, object payload, CancellationToken cancellationToken = default)
    {
        if (string.IsNullOrEmpty(_baseUrl))
        {
            return null;
        }
        string json = JsonSerializer.Serialize(payload);
        using var content = new StringContent(json, Encoding.UTF8, "application/json");
        using var resp = await _httpClient.PutAsync($"{_baseUrl}{relativePath}", content, cancellationToken).ConfigureAwait(false);
        resp.EnsureSuccessStatusCode();
        string body = await resp.Content.ReadAsStringAsync(cancellationToken).ConfigureAwait(false);
        return JsonDocument.Parse(body);
    }

    public async Task<bool> DeleteAsync(string relativePath, CancellationToken cancellationToken = default)
    {
        if (string.IsNullOrEmpty(_baseUrl))
        {
            return false;
        }
        using var resp = await _httpClient.DeleteAsync($"{_baseUrl}{relativePath}", cancellationToken).ConfigureAwait(false);
        return resp.IsSuccessStatusCode;
    }

    private static ProcessStartInfo? ResolveSidecarStartInfo(
        string? customDir,
        int port,
        string token,
        string dataDir)
    {
        string baseDir = customDir ?? AppContext.BaseDirectory;
        string bundledExe = Path.Combine(baseDir, "groundwork-core", "groundwork-core.exe");
        if (!File.Exists(bundledExe))
        {
            bundledExe = Path.Combine(baseDir, "groundwork-core.exe");
        }

        ProcessStartInfo psi;
        if (File.Exists(bundledExe))
        {
            psi = new ProcessStartInfo
            {
                FileName = bundledExe,
                WorkingDirectory = Path.GetDirectoryName(bundledExe) ?? baseDir,
                UseShellExecute = false,
                CreateNoWindow = true
            };
        }
        else
        {
            // Development fallback: locate server\.venv\Scripts\python.exe and server\core_entry.py
            string? repoRoot = FindRepoRoot(baseDir);
            if (repoRoot == null)
            {
                return null;
            }
            string venvPython = Path.Combine(repoRoot, "server", ".venv", "Scripts", "python.exe");
            string entryPy = Path.Combine(repoRoot, "server", "core_entry.py");
            if (!File.Exists(venvPython) || !File.Exists(entryPy))
            {
                return null;
            }

            psi = new ProcessStartInfo
            {
                FileName = venvPython,
                WorkingDirectory = Path.Combine(repoRoot, "server"),
                UseShellExecute = false,
                CreateNoWindow = true
            };
            psi.ArgumentList.Add(entryPy);
        }

        psi.Environment["GROUNDWORK_HOST"] = "127.0.0.1";
        psi.Environment["GROUNDWORK_PORT"] = port.ToString();
        psi.Environment["GROUNDWORK_CORE_PORT"] = port.ToString();
        psi.Environment["GROUNDWORK_CORE_TOKEN"] = token;
        psi.Environment["GROUNDWORK_DATA_DIR"] = dataDir;
        psi.Environment["GROUNDWORK_DATABASE_PATH"] = Path.Combine(dataDir, "groundwork.db");
        return psi;
    }

    private static string? FindRepoRoot(string startDir)
    {
        var dir = new DirectoryInfo(startDir);
        while (dir != null)
        {
            if (Directory.Exists(Path.Combine(dir.FullName, "server")) &&
                File.Exists(Path.Combine(dir.FullName, "server", "core_entry.py")))
            {
                return dir.FullName;
            }
            dir = dir.Parent;
        }
        return null;
    }

    private static int FindAvailableLoopbackPort()
    {
        using var listener = new TcpListener(IPAddress.Loopback, 0);
        listener.Start();
        return ((IPEndPoint)listener.LocalEndpoint).Port;
    }

    private void AttachToKillOnCloseJobObject(Process process)
    {
        if (!OperatingSystem.IsWindows())
        {
            return;
        }
        try
        {
            if (_jobHandle == IntPtr.Zero)
            {
                _jobHandle = CreateJobObjectW(IntPtr.Zero, null);
                if (_jobHandle != IntPtr.Zero)
                {
                    var info = new JOBOBJECT_EXTENDED_LIMIT_INFORMATION();
                    info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
                    SetInformationJobObject(
                        _jobHandle,
                        JOBOBJECTINFOCLASS.JobObjectExtendedLimitInformation,
                        ref info,
                        (uint)Marshal.SizeOf<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>());
                }
            }

            if (_jobHandle != IntPtr.Zero)
            {
                AssignProcessToJobObject(_jobHandle, process.Handle);
            }
        }
        catch
        {
        }
    }

    public async ValueTask DisposeAsync()
    {
        try
        {
            if (!string.IsNullOrEmpty(_baseUrl) && IsRunning)
            {
                using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(2));
                await _httpClient.PostAsync($"{_baseUrl}/api/system/shutdown", null, cts.Token).ConfigureAwait(false);
            }
        }
        catch
        {
        }

        try
        {
            if (_coreProcess is { HasExited: false })
            {
                _coreProcess.Kill(entireProcessTree: true);
            }
        }
        catch
        {
        }
        finally
        {
            _coreProcess?.Dispose();
            _coreProcess = null;
        }

        if (_jobHandle != IntPtr.Zero)
        {
            CloseHandle(_jobHandle);
            _jobHandle = IntPtr.Zero;
        }
    }
}
