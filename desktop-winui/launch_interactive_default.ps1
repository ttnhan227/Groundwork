Add-Type -AssemblyName System.Drawing, System.Windows.Forms -ErrorAction SilentlyContinue

$csharp = @"
using System;
using System.Runtime.InteropServices;

public class DirectLauncher {
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Auto)]
    public struct STARTUPINFO {
        public uint cb;
        public string lpReserved;
        public string lpDesktop;
        public string lpTitle;
        public uint dwX;
        public uint dwY;
        public uint dwXSize;
        public uint dwYSize;
        public uint dwXCountChars;
        public uint dwYCountChars;
        public uint dwFillAttribute;
        public uint dwFlags;
        public short wShowWindow;
        public short cbReserved2;
        public IntPtr lpReserved2;
        public IntPtr hStdInput;
        public IntPtr hStdOutput;
        public IntPtr hStdError;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct PROCESS_INFORMATION {
        public IntPtr hProcess;
        public IntPtr hThread;
        public uint dwProcessId;
        public uint dwThreadId;
    }

    [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Auto)]
    public static extern bool CreateProcess(
        string lpApplicationName,
        string lpCommandLine,
        IntPtr lpProcessAttributes,
        IntPtr lpThreadAttributes,
        bool bInheritHandles,
        uint dwCreationFlags,
        IntPtr lpEnvironment,
        string lpCurrentDirectory,
        ref STARTUPINFO lpStartupInfo,
        out PROCESS_INFORMATION lpProcessInformation);

    public static uint Launch(string exePath) {
        STARTUPINFO si = new STARTUPINFO();
        si.cb = (uint)Marshal.SizeOf(typeof(STARTUPINFO));
        si.lpDesktop = @"WinSta0\Default";

        PROCESS_INFORMATION pi = new PROCESS_INFORMATION();
        bool ok = CreateProcess(exePath, null, IntPtr.Zero, IntPtr.Zero, false, 0, IntPtr.Zero, null, ref si, out pi);
        if (!ok) {
            int err = Marshal.GetLastWin32Error();
            Console.WriteLine("CreateProcess error: " + err);
            return 0;
        }
        return pi.dwProcessId;
    }
}
"@
Add-Type -TypeDefinition $csharp -ErrorAction SilentlyContinue

$exePath = "D:\projects\Groundwork\desktop-winui\src\Groundwork.Desktop\bin\Release\net10.0-windows10.0.19041.0\win-x64\Groundwork.Desktop.exe"
$appPid = [DirectLauncher]::Launch($exePath)

if ($appPid -ne 0) {
    Write-Host "Groundwork launched directly onto physical desktop WinSta0\Default (PID: $appPid)."
    Wait-Process -Id $appPid
    Write-Host "Groundwork process $appPid closed."
} else {
    Write-Host "Failed to launch Groundwork."
}
