"""Windows' launchable app catalogue, including desktop and packaged apps."""
import json
import os
import re
import subprocess
import sys
import threading
import time

_lock = threading.Lock()
_cached = None
_updated = 0.0

# Ask Windows Shell for the same applications and icons as its Apps folder.
# No user input is interpolated into this script.
_SCRIPT = r'''
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
Add-Type -ReferencedAssemblies System.Drawing -TypeDefinition @'
using System;
using System.Drawing;
using System.IO;
using System.Runtime.InteropServices;
public static class AppIcon {
 [StructLayout(LayoutKind.Sequential)] public struct Size { public int x,y; }
 [ComImport, Guid("bcc18b79-ba16-442f-80c4-8a59c30c463b"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
 interface Factory { [PreserveSig] int GetImage(Size size, int flags, out IntPtr bitmap); }
 [DllImport("shell32.dll", CharSet=CharSet.Unicode, PreserveSig=false)]
 static extern void SHCreateItemFromParsingName(string path, IntPtr context, ref Guid iid, [MarshalAs(UnmanagedType.Interface)] out Factory item);
 [DllImport("gdi32.dll")] static extern bool DeleteObject(IntPtr value);
 public static string Read(string path) {
  Factory item = null; IntPtr handle = IntPtr.Zero;
  try {
   Guid iid = new Guid("bcc18b79-ba16-442f-80c4-8a59c30c463b");
   SHCreateItemFromParsingName(path, IntPtr.Zero, ref iid, out item);
   if(item.GetImage(new Size {x=48,y=48}, 4, out handle)!=0) return "";
   using(var image=Image.FromHbitmap(handle)) using(var stream=new MemoryStream()) {
    image.Save(stream,System.Drawing.Imaging.ImageFormat.Png);
    return "data:image/png;base64,"+Convert.ToBase64String(stream.ToArray());
   }
  } catch { return ""; }
  finally { if(handle!=IntPtr.Zero) DeleteObject(handle); if(item!=null) Marshal.ReleaseComObject(item); }
 }
}
'@
$shell = New-Object -ComObject Shell.Application
$folder = $shell.Namespace('shell:AppsFolder')
if ($null -eq $folder) { throw 'Windows app catalogue is unavailable' }
$registry = @{}
@('HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*', 'HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*', 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*') | ForEach-Object {
 Get-ItemProperty $_ -ErrorAction SilentlyContinue | ForEach-Object { if ($_.DisplayName) { $registry[[string]$_.DisplayName] = $_ } }
}
$packages = @{}
Get-AppxPackage -ErrorAction SilentlyContinue | ForEach-Object { $packages[$_.PackageFamilyName] = $_ }
$apps = @($folder.Items() | ForEach-Object {
 $id = [string]$_.Path
 $target = [string]$_.ExtendedProperty('System.Link.TargetParsingPath')
 $name = [string]$_.Name
 $publisher = [string]$_.ExtendedProperty('System.Company')
 $version = [string]$_.ExtendedProperty('System.FileVersion')
 $description = [string]$_.ExtendedProperty('System.FileDescription')
 $entry = $registry[$name]
 if ($entry) {
  if (!$publisher) { $publisher = [string]$entry.Publisher }
  if (!$version) { $version = [string]$entry.DisplayVersion }
  if (!$target) { $target = [string]$entry.InstallLocation }
 }
 if ($id.Contains('!')) {
  $package = $packages[$id.Split('!')[0]]
  if ($package) {
   if (!$publisher) { $publisher = [string]$package.Publisher }
   if (!$version) { $version = [string]$package.Version }
   if (!$target) { $target = [string]$package.InstallLocation }
  }
 }
 if (!$target -and [IO.Path]::IsPathRooted($id)) { $target = $id }
 if ($target -and (Test-Path -LiteralPath $target -PathType Leaf)) {
  $info = [Diagnostics.FileVersionInfo]::GetVersionInfo($target)
  if (!$publisher) { $publisher = $info.CompanyName }
  if (!$version) { $version = $info.FileVersion }
  if (!$description) { $description = $info.FileDescription }
 }
 [PSCustomObject]@{
  id=$id; name=$name;
  publisher=$publisher;
  version=$version;
  description=$description;
  location=$target;
  kind=$(if ($id.Contains('!')) {'Packaged app'} else {'Desktop app'});
  icon=[AppIcon]::Read('shell:AppsFolder\'+$id)
 }
})
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
ConvertTo-Json -InputObject $apps -Depth 4 -Compress
'''


def list_apps(refresh=False):
    global _cached, _updated
    if sys.platform != "win32":
        return {"apps": [], "supported": False}
    with _lock:
        if _cached is None or refresh or time.monotonic() - _updated > 300:
            import base64
            result = subprocess.run(
                [str(os.path.join(os.environ["WINDIR"], "System32", "WindowsPowerShell", "v1.0", "powershell.exe")),
                 "-NoProfile", "-NonInteractive", "-STA", "-EncodedCommand",
                 base64.b64encode(_SCRIPT.encode("utf-16-le")).decode("ascii")],
                capture_output=True, timeout=60, creationflags=0x08000000,
            )
            if result.returncode:
                raise RuntimeError("Windows couldn't read installed apps. Try refreshing the list.")
            values = json.loads(result.stdout.decode("utf-8-sig"))
            unique = {app["id"]: app for app in values if app.get("id") and app.get("name")}
            for app in unique.values():
                for field in ("publisher", "version", "description", "location", "icon"):
                    app[field] = app.get(field) or ""
                publisher = app["publisher"]
                if publisher.startswith("CN="):
                    # Certificate distinguished names aren't useful app labels.
                    match = re.search(r'(?:^|,\s*)O=("[^"]+"|[^,]+)', publisher) or re.search(r'^CN=("[^"]+"|[^,]+)', publisher)
                    if match:
                        app["publisher"] = match.group(1).strip('"')
            _cached = sorted(unique.values(), key=lambda app: app["name"].casefold())
            _updated = time.monotonic()
        return {"apps": _cached, "supported": True}


def launch_app(app_id):
    # Launch only an item Windows actually enumerated, never a caller's command.
    if not any(app["id"] == app_id for app in list_apps()["apps"]):
        raise ValueError("This app is no longer available. Refresh the app list.")
    os.startfile("shell:AppsFolder\\" + app_id)
    return {"success": True}
