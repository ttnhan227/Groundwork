using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.IO.Pipes;
using System.Runtime.InteropServices;
using System.Security.Principal;
using System.Text;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using Groundwork.Engine.Models;

namespace Groundwork.Engine.Services;

public sealed class NtfsMftScanner
{
    private const uint GENERIC_READ = 0x80000000;
    private const uint FILE_SHARE_READ = 0x00000001;
    private const uint FILE_SHARE_WRITE = 0x00000002;
    private const uint FILE_SHARE_DELETE = 0x00000004;
    private const uint OPEN_EXISTING = 3;
    private const uint FSCTL_QUERY_USN_JOURNAL = 0x000900f4;
    private const uint FSCTL_ENUM_USN_DATA = 0x000900b3;
    private const uint FILE_ATTRIBUTE_DIRECTORY = 0x00000010;
    private static readonly IntPtr INVALID_HANDLE_VALUE = new(-1);

    [StructLayout(LayoutKind.Sequential)]
    private struct USN_JOURNAL_DATA_V0
    {
        public ulong UsnJournalID;
        public long FirstUsn;
        public long NextUsn;
        public long LowestValidUsn;
        public long MaxUsn;
        public ulong MaximumSize;
        public ulong AllocationDelta;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct MFT_ENUM_DATA_V0
    {
        public ulong StartFileReferenceNumber;
        public long LowUsn;
        public long HighUsn;
    }

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern IntPtr CreateFileW(
        string lpFileName,
        uint dwDesiredAccess,
        uint dwShareMode,
        IntPtr lpSecurityAttributes,
        uint dwCreationDisposition,
        uint dwFlagsAndAttributes,
        IntPtr hTemplateFile);

    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool DeviceIoControl(
        IntPtr hDevice,
        uint dwIoControlCode,
        IntPtr lpInBuffer,
        uint nInBufferSize,
        IntPtr lpOutBuffer,
        uint nOutBufferSize,
        out uint lpBytesReturned,
        IntPtr lpOverlapped);

    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool CloseHandle(IntPtr hObject);

    public static bool IsCurrentProcessElevated()
    {
        if (!OperatingSystem.IsWindows())
        {
            return false;
        }
        using var identity = WindowsIdentity.GetCurrent();
        var principal = new WindowsPrincipal(identity);
        return principal.IsInRole(WindowsBuiltInRole.Administrator);
    }

    /// <summary>
    /// Attempts an NTFS USN/MFT enumeration if elevated, or invokes Groundwork.MftHelper.exe with UAC ('runas') if requested.
    /// Automatically falls back to Win32StorageScanner if the user declines elevation or the volume is not NTFS.
    /// </summary>
    public async Task<DriveScanResult> ScanWithFallbackAsync(
        string rootPath,
        bool requestElevationIfNeeded = false,
        string? mftHelperExecutablePath = null,
        IProgress<ScanProgressReport>? progress = null,
        int topN = 25,
        bool retainAllEntries = false,
        CancellationToken cancellationToken = default,
        StorageScanOptions? options = null)
    {
        string normalizedRoot = Path.GetFullPath(rootPath);
        string driveLetter = Path.GetPathRoot(normalizedRoot)?.TrimEnd('\\') ?? string.Empty;

        if (IsCurrentProcessElevated() && driveLetter.Length == 2 && driveLetter[1] == ':')
        {
            return await new Win32StorageScanner().ScanAsync(
                normalizedRoot,
                progress,
                topN,
                retainAllEntries,
                cancellationToken,
                options).ConfigureAwait(false);
        }
        else if (requestElevationIfNeeded && !string.IsNullOrWhiteSpace(mftHelperExecutablePath) && File.Exists(mftHelperExecutablePath))
        {
            var elevatedResult = await TryRunElevatedHelperAsync(normalizedRoot, mftHelperExecutablePath, topN, cancellationToken).ConfigureAwait(false);
            if (elevatedResult != null)
            {
                return elevatedResult;
            }
        }

        // Default non-admin fallback: parallel Win32 FindFirstFileExW (FindExInfoBasic)
        return await new Win32StorageScanner().ScanAsync(
            normalizedRoot,
            progress,
            topN,
            retainAllEntries,
            cancellationToken,
            options).ConfigureAwait(false);
    }

    /// <summary>
    /// Directly enumerates NTFS Master File Table records via FSCTL_ENUM_USN_DATA on \\.\X: when elevated.
    /// </summary>
    public unsafe IReadOnlyList<(ulong FileRef, ulong ParentRef, string Name, bool IsDir)>? TryEnumerateNtfsUsnRecords(
        string driveColon,
        CancellationToken cancellationToken = default)
    {
        string volumeDevicePath = @"\\.\" + driveColon.TrimEnd('\\');
        IntPtr hVol = CreateFileW(
            volumeDevicePath,
            GENERIC_READ,
            FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE,
            IntPtr.Zero,
            OPEN_EXISTING,
            0,
            IntPtr.Zero);

        if (hVol == INVALID_HANDLE_VALUE)
        {
            return null;
        }

        try
        {
            var journalData = new USN_JOURNAL_DATA_V0();
            uint bytesReturned;
            IntPtr journalPtr = new(&journalData);
            long highUsn = long.MaxValue;
            if (DeviceIoControl(
                hVol,
                FSCTL_QUERY_USN_JOURNAL,
                IntPtr.Zero,
                0,
                journalPtr,
                (uint)sizeof(USN_JOURNAL_DATA_V0),
                out bytesReturned,
                IntPtr.Zero))
            {
                highUsn = journalData.NextUsn;
            }

            var enumData = new MFT_ENUM_DATA_V0
            {
                StartFileReferenceNumber = 0,
                LowUsn = 0,
                HighUsn = highUsn
            };

            const int bufferSize = 64 * 1024;
            IntPtr outBuffer = Marshal.AllocHGlobal(bufferSize);
            var records = new List<(ulong, ulong, string, bool)>(capacity: 65536);

            try
            {
                IntPtr enumPtr = new(&enumData);
                while (DeviceIoControl(
                    hVol,
                    FSCTL_ENUM_USN_DATA,
                    enumPtr,
                    (uint)sizeof(MFT_ENUM_DATA_V0),
                    outBuffer,
                    bufferSize,
                    out bytesReturned,
                    IntPtr.Zero))
                {
                    cancellationToken.ThrowIfCancellationRequested();
                    if (bytesReturned <= sizeof(ulong))
                    {
                        break;
                    }

                    enumData.StartFileReferenceNumber = (ulong)Marshal.ReadInt64(outBuffer, 0);
                    int offset = sizeof(ulong);

                    while (offset + 60 <= bytesReturned)
                    {
                        uint recordLen = (uint)Marshal.ReadInt32(outBuffer, offset);
                        if (recordLen == 0 || offset + recordLen > bytesReturned)
                        {
                            break;
                        }

                        ulong fileRef = (ulong)Marshal.ReadInt64(outBuffer, offset + 8) & 0x0000FFFFFFFFFFFFUL;
                        ulong parentRef = (ulong)Marshal.ReadInt64(outBuffer, offset + 16) & 0x0000FFFFFFFFFFFFUL;
                        uint attrs = (uint)Marshal.ReadInt32(outBuffer, offset + 52);
                        ushort nameLen = (ushort)Marshal.ReadInt16(outBuffer, offset + 56);
                        ushort nameOffset = (ushort)Marshal.ReadInt16(outBuffer, offset + 58);

                        if (nameLen > 0 && offset + nameOffset + nameLen <= bytesReturned)
                        {
                            string name = Marshal.PtrToStringUni(IntPtr.Add(outBuffer, offset + nameOffset), nameLen / 2) ?? string.Empty;
                            bool isDir = (attrs & FILE_ATTRIBUTE_DIRECTORY) != 0;
                            records.Add((fileRef, parentRef, name, isDir));
                        }

                        offset += (int)recordLen;
                    }
                }
            }
            finally
            {
                Marshal.FreeHGlobal(outBuffer);
            }

            return records;
        }
        finally
        {
            CloseHandle(hVol);
        }
    }

    private static async Task<DriveScanResult?> TryRunElevatedHelperAsync(
        string rootPath,
        string helperExe,
        int topN,
        CancellationToken cancellationToken)
    {
        string pipeName = "GroundworkMftPipe_" + Guid.NewGuid().ToString("N");
        using var pipeServer = new NamedPipeServerStream(
            pipeName,
            PipeDirection.In,
            1,
            PipeTransmissionMode.Byte,
            PipeOptions.Asynchronous);

        var psi = new ProcessStartInfo
        {
            FileName = helperExe,
            Arguments = $"--root \"{rootPath}\" --pipe \"{pipeName}\" --top {topN}",
            UseShellExecute = true,
            Verb = "runas",
            WindowStyle = ProcessWindowStyle.Hidden
        };

        try
        {
            using var proc = Process.Start(psi);
            if (proc == null)
            {
                return null;
            }

            using var timeoutCts = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
            timeoutCts.CancelAfter(TimeSpan.FromSeconds(120));

            await pipeServer.WaitForConnectionAsync(timeoutCts.Token).ConfigureAwait(false);
            using var reader = new StreamReader(pipeServer, Encoding.UTF8);
            string json = await reader.ReadToEndAsync(timeoutCts.Token).ConfigureAwait(false);
            if (string.IsNullOrWhiteSpace(json))
            {
                return null;
            }

            return JsonSerializer.Deserialize<DriveScanResult>(json);
        }
        catch
        {
            // User cancelled UAC prompt or pipe timed out -> gracefully fall back
            return null;
        }
    }
}
