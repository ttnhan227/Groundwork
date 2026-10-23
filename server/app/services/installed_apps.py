"""Windows Installed Application Inventory, Guided Uninstaller, and Leftover Scanner.

Provides:
1. Full catalogue of Windows Desktop (Win32 Registry Uninstall), Packaged (Appx), and Shell applications with publisher, version, install date, reported size (distinguishing None vs 0), install location, and uninstall command.
2. Token-confirmed, shell-injection-safe uninstaller launching.
3. Post-uninstall leftover directory/file and registry scanning with explicit confidence levels ('high' vs 'review_required') and connection evidence.
"""

from __future__ import annotations

import json
import os
import re
import shlex
import subprocess
import sys
import threading
import time
from pathlib import Path
from typing import Any

from app.core.security import consume_confirmation_token, generate_confirmation_token

_lock = threading.Lock()
_cached: list[dict[str, Any]] | None = None
_updated = 0.0

# Ask Windows Shell & Uninstall Registry for installed applications, sizes, dates, and uninstallers.
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
 Get-ItemProperty $_ -ErrorAction SilentlyContinue | ForEach-Object {
  if ($_.DisplayName -and $_.SystemComponent -ne 1) {
   $registry[[string]$_.DisplayName] = $_
  }
 }
}
$packages = @{}
Get-AppxPackage -ErrorAction SilentlyContinue | ForEach-Object { $packages[$_.PackageFamilyName] = $_ }
$matchedRegNames = @{}
$apps = [System.Collections.Generic.List[object]]::new()
$folder.Items() | ForEach-Object {
 $id = [string]$_.Path
 $target = [string]$_.ExtendedProperty('System.Link.TargetParsingPath')
 $name = [string]$_.Name
 $publisher = [string]$_.ExtendedProperty('System.Company')
 $version = [string]$_.ExtendedProperty('System.FileVersion')
 $description = [string]$_.ExtendedProperty('System.FileDescription')
 $installLocation = ''
 $installDate = ''
 $uninstallString = ''
 $quietUninstallString = ''
 $estimatedSizeKb = $null
 $regKey = ''
 $entry = $registry[$name]
 if ($entry) {
  $matchedRegNames[$name] = $true
  if (!$publisher) { $publisher = [string]$entry.Publisher }
  if (!$version) { $version = [string]$entry.DisplayVersion }
  if ($entry.InstallLocation) { $installLocation = [string]$entry.InstallLocation }
  if (!$target -and $installLocation) { $target = $installLocation }
  if ($entry.InstallDate) { $installDate = [string]$entry.InstallDate }
  if ($entry.UninstallString) { $uninstallString = [string]$entry.UninstallString }
  if ($entry.QuietUninstallString) { $quietUninstallString = [string]$entry.QuietUninstallString }
  if ($null -ne $entry.EstimatedSize) { $estimatedSizeKb = [long]$entry.EstimatedSize }
  if ($entry.PSChildName) { $regKey = [string]$entry.PSChildName }
 }
 if ($id.Contains('!')) {
  $package = $packages[$id.Split('!')[0]]
  if ($package) {
   if (!$publisher) { $publisher = [string]$package.Publisher }
   if (!$version) { $version = [string]$package.Version }
   if ($package.InstallLocation) { $installLocation = [string]$package.InstallLocation }
   if (!$target) { $target = [string]$package.InstallLocation }
  }
 }
 if (!$target -and [IO.Path]::IsPathRooted($id)) { $target = $id }
 if ($target -and (Test-Path -LiteralPath $target -PathType Leaf)) {
  $info = [Diagnostics.FileVersionInfo]::GetVersionInfo($target)
  if (!$publisher) { $publisher = $info.CompanyName }
  if (!$version) { $version = $info.FileVersion }
  if (!$description) { $description = $info.FileDescription }
  if (!$installLocation) { $installLocation = [IO.Path]::GetDirectoryName($target) }
 }
 $apps.Add([PSCustomObject]@{
  id=$id; name=$name;
  publisher=$publisher;
  version=$version;
  description=$description;
  location=$target;
  install_location=$installLocation;
  install_date=$installDate;
  uninstall_string=$uninstallString;
  quiet_uninstall_string=$quietUninstallString;
  estimated_size_kb=$estimatedSizeKb;
  registry_key=$regKey;
  kind=$(if ($id.Contains('!')) {'Packaged app'} else {'Desktop app'});
  icon=[AppIcon]::Read('shell:AppsFolder\'+$id)
 })
}
foreach ($kv in $registry.GetEnumerator()) {
 $rName = $kv.Key
 if ($matchedRegNames.ContainsKey($rName)) { continue }
 $e = $kv.Value
 if (!$e.UninstallString -and !$e.InstallLocation) { continue }
 $rId = 'reg:' + $(if ($e.PSChildName) { [string]$e.PSChildName } else { $rName })
 $apps.Add([PSCustomObject]@{
  id=$rId; name=$rName;
  publisher=[string]$e.Publisher;
  version=[string]$e.DisplayVersion;
  description='';
  location=[string]$e.InstallLocation;
  install_location=[string]$e.InstallLocation;
  install_date=[string]$e.InstallDate;
  uninstall_string=[string]$e.UninstallString;
  quiet_uninstall_string=[string]$e.QuietUninstallString;
  estimated_size_kb=$(if ($null -ne $e.EstimatedSize) { [long]$e.EstimatedSize } else { $null });
  registry_key=[string]$e.PSChildName;
  kind='Desktop app';
  icon=''
 })
}
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
ConvertTo-Json -InputObject $apps -Depth 4 -Compress
'''

NOISE_TOKENS = {
    "app",
    "application",
    "inc",
    "llc",
    "ltd",
    "corp",
    "corporation",
    "company",
    "co",
    "software",
    "technologies",
    "technology",
    "systems",
    "system",
    "the",
    "for",
    "windows",
    "desktop",
    "client",
    "setup",
    "installer",
    "x64",
    "x86",
    "64bit",
    "32bit",
    "en",
    "us",
}

GENERIC_SHARED_VENDORS = {
    "microsoft",
    "microsoft corporation",
    "windows",
    "google",
    "apple",
    "adobe",
    "intel",
    "amd",
    "nvidia",
    "realtek",
}


def _normalize_install_date(raw: Any) -> str:
    if not raw or not isinstance(raw, str):
        return ""
    cleaned = raw.strip()
    if len(cleaned) == 8 and cleaned.isdigit():
        return f"{cleaned[:4]}-{cleaned[4:6]}-{cleaned[6:8]}"
    return cleaned


def _normalize_app_entry(app: dict[str, Any]) -> dict[str, Any]:
    for field in (
        "publisher",
        "version",
        "description",
        "location",
        "install_location",
        "install_date",
        "uninstall_string",
        "quiet_uninstall_string",
        "registry_key",
        "icon",
    ):
        app[field] = app.get(field) or ""
    if not app.get("kind"):
        app["kind"] = "Packaged app" if "!" in str(app.get("id", "")) else "Desktop app"

    publisher = app["publisher"]
    if publisher.startswith("CN="):
        match = re.search(r'(?:^|,\s*)O=("[^"]+"|[^,]+)', publisher) or re.search(
            r'^CN=("[^"]+"|[^,]+)', publisher
        )
        if match:
            app["publisher"] = match.group(1).strip('"')

    app["install_date"] = _normalize_install_date(app.get("install_date"))

    # Explicitly distinguish unknown size (None) from 0 or reported KB size
    raw_kb = app.get("estimated_size_kb")
    raw_bytes = app.get("estimated_size_bytes")
    if raw_bytes is not None and isinstance(raw_bytes, (int, float)) and raw_bytes >= 0:
        app["estimated_size_bytes"] = int(raw_bytes)
    elif raw_kb is not None and isinstance(raw_kb, (int, float)) and raw_kb >= 0:
        app["estimated_size_bytes"] = int(raw_kb) * 1024
    else:
        app["estimated_size_bytes"] = None

    if not app["install_location"] and app["location"]:
        loc_path = Path(app["location"])
        if loc_path.suffix.lower() in {".exe", ".dll", ".msc"}:
            app["install_location"] = str(loc_path.parent)
        else:
            app["install_location"] = app["location"]

    app_id = str(app.get("id", ""))
    app["can_launch"] = not app_id.startswith("reg:")
    app["can_uninstall"] = bool(app.get("uninstall_string", "").strip())
    return app


def list_apps(refresh: bool = False) -> dict[str, Any]:
    global _cached, _updated
    if sys.platform != "win32":
        return {"apps": [], "supported": False}
    with _lock:
        if _cached is None or refresh or time.monotonic() - _updated > 300:
            import base64

            result = subprocess.run(
                [
                    str(
                        os.path.join(
                            os.environ["WINDIR"],
                            "System32",
                            "WindowsPowerShell",
                            "v1.0",
                            "powershell.exe",
                        )
                    ),
                    "-NoProfile",
                    "-NonInteractive",
                    "-STA",
                    "-EncodedCommand",
                    base64.b64encode(_SCRIPT.encode("utf-16-le")).decode("ascii"),
                ],
                capture_output=True,
                timeout=60,
                creationflags=0x08000000,
            )
            if result.returncode:
                raise RuntimeError("Windows couldn't read installed apps. Try refreshing the list.")
            values = json.loads(result.stdout.decode("utf-8-sig"))
            if isinstance(values, dict):
                values = [values]
            unique = {
                app["id"]: _normalize_app_entry(dict(app))
                for app in values
                if isinstance(app, dict) and app.get("id") and app.get("name")
            }
            _cached = sorted(unique.values(), key=lambda app: app["name"].casefold())
            _updated = time.monotonic()
        return {"apps": _cached, "supported": True}


def launch_app(app_id: str) -> dict[str, bool]:
    # Launch only an item Windows actually enumerated, never a caller's command.
    apps = list_apps()["apps"]
    matched = next((app for app in apps if app["id"] == app_id), None)
    if not matched:
        raise ValueError("This app is no longer available. Refresh the app list.")
    if str(app_id).startswith("reg:"):
        raise ValueError("This program entry does not have a direct launch shortcut.")
    os.startfile("shell:AppsFolder\\" + app_id)
    return {"success": True}


def parse_uninstall_command(uninstall_string: str) -> list[str]:
    """Safely parses a Windows registry UninstallString into an executable + arguments list without invoking a shell."""
    if not uninstall_string or not isinstance(uninstall_string, str):
        raise ValueError("No uninstaller command is registered for this application.")
    cleaned = uninstall_string.strip()
    if len(cleaned) > 2048:
        raise ValueError("Registered uninstaller command is invalid.")
    if any(ch in cleaned for ch in "&|;<>`\n\r$"):
        raise ValueError("Uninstaller command contains unsafe shell operators and was blocked.")

    # Handle unquoted paths containing spaces up to .exe (common in Windows UninstallString)
    exe_match = re.match(r'^"?([A-Za-z]:\\[^"]*?\.exe)"?(?:\s+(.*))?$', cleaned, re.IGNORECASE)
    if exe_match:
        exe_path = exe_match.group(1).strip()
        rest = (exe_match.group(2) or "").strip()
        args = shlex.split(rest, posix=False) if rest else []
        cleaned_args = [a.strip('"') if (a.startswith('"') and a.endswith('"')) else a for a in args]
        return [exe_path, *cleaned_args]

    # Handle MsiExec.exe commands (e.g. MsiExec.exe /I{GUID} or MsiExec.exe /X{GUID})
    msi_match = re.match(r"^(?:msiexec(?:\.exe)?)\s+(.*)$", cleaned, re.IGNORECASE)
    if msi_match:
        windir = os.environ.get("WINDIR", r"C:\Windows")
        msiexec_bin = str(Path(windir) / "System32" / "msiexec.exe")
        rest = msi_match.group(1).strip()
        args = shlex.split(rest, posix=False) if rest else []
        cleaned_args = [a.strip('"') if (a.startswith('"') and a.endswith('"')) else a for a in args]
        return [msiexec_bin, *cleaned_args]

    parts = shlex.split(cleaned, posix=False)
    if not parts:
        raise ValueError("Empty uninstaller command.")
    exe = parts[0].strip('"')
    rest_args = [a.strip('"') if (a.startswith('"') and a.endswith('"')) else a for a in parts[1:]]
    return [exe, *rest_args]


def propose_uninstall(app_id: str) -> dict[str, Any]:
    """Prepares a verified uninstall proposal and single-use confirmation token for an enumerated app."""
    apps = list_apps()["apps"]
    matched = next((app for app in apps if app["id"] == app_id), None)
    if not matched:
        raise ValueError("Application not found in current inventory. Refresh the app list and try again.")

    uninstall_str = (matched.get("uninstall_string") or "").strip()
    if not uninstall_str:
        raise ValueError(
            f"'{matched.get('name', app_id)}' does not expose a standard desktop uninstaller command. "
            "For Microsoft Store / packaged apps, use Windows Installed Apps settings."
        )

    argv = parse_uninstall_command(uninstall_str)
    exe_path = Path(argv[0])
    # Verify executable exists if it's an absolute path
    if exe_path.is_absolute() and not exe_path.is_file() and exe_path.name.lower() != "msiexec.exe":
        raise ValueError(f"Registered uninstaller executable was not found at '{argv[0]}'.")

    proposal = {
        "action": "app-uninstall",
        "app_id": matched["id"],
        "app_name": matched["name"],
        "publisher": matched.get("publisher", ""),
        "version": matched.get("version", ""),
        "install_location": matched.get("install_location") or matched.get("location") or "",
        "uninstall_command": uninstall_str,
        "argv": argv,
    }
    token = generate_confirmation_token("app-uninstall", proposal)
    return {
        "proposal": proposal,
        "confirmation_token": token,
        "warning": (
            f"Groundwork will launch the registered uninstaller for '{matched['name']}'. "
            "Complete or cancel the vendor's uninstaller window, then run 'Scan for Leftovers' to inspect remaining app data."
        ),
    }


def execute_uninstall(proposal: dict[str, Any], confirmation_token: str) -> dict[str, Any]:
    """Launches a confirmed application uninstaller without shell interpolation."""
    global _cached
    receipt = consume_confirmation_token(confirmation_token)
    if not receipt or receipt.get("action_type") != "app-uninstall" or receipt.get("details") != proposal:
        raise PermissionError("Uninstall confirmation expired or does not match the selected application.")

    uninstall_cmd = proposal.get("uninstall_command", "")
    argv = parse_uninstall_command(uninstall_cmd)
    exe_path = Path(argv[0])
    if exe_path.is_absolute() and not exe_path.is_file() and exe_path.name.lower() != "msiexec.exe":
        raise FileNotFoundError(f"Uninstaller executable not found: '{argv[0]}'")

    proc = subprocess.Popen(argv, shell=False)
    with _lock:
        _cached = None

    return {
        "status": "launched",
        "pid": proc.pid,
        "app_id": proposal.get("app_id", ""),
        "app_name": proposal.get("app_name", ""),
        "publisher": proposal.get("publisher", ""),
        "install_location": proposal.get("install_location", ""),
        "command": uninstall_cmd,
        "can_scan_leftovers": True,
    }


def _extract_tokens(text: str) -> list[str]:
    words = [w.lower() for w in re.findall(r"[A-Za-z0-9]{3,}", text or "")]
    return [w for w in words if w not in NOISE_TOKENS and not w.isdigit()]


def _bounded_dir_stats(directory: Path, max_files: int = 1500) -> tuple[int, int]:
    """Returns (total_bytes, file_count) for a directory without hanging on huge trees."""
    total_bytes = 0
    file_count = 0
    try:
        stack = [directory]
        while stack and file_count < max_files:
            current = stack.pop()
            try:
                with os.scandir(current) as it:
                    for entry in it:
                        try:
                            if entry.is_symlink():
                                continue
                            if entry.is_dir(follow_symlinks=False):
                                stack.append(Path(entry.path))
                            elif entry.is_file(follow_symlinks=False):
                                total_bytes += entry.stat(follow_symlinks=False).st_size
                                file_count += 1
                                if file_count >= max_files:
                                    break
                        except OSError:
                            continue
            except OSError:
                continue
    except OSError:
        pass
    return total_bytes, file_count


def default_leftover_search_roots() -> list[tuple[str, Path]]:
    """Returns standard Windows application data and install directories for leftover scanning."""
    roots: list[tuple[str, Path]] = []
    env_map = [
        ("AppData (Local)", os.environ.get("LOCALAPPDATA")),
        ("AppData (Local Programs)", os.path.join(os.environ.get("LOCALAPPDATA", ""), "Programs") if os.environ.get("LOCALAPPDATA") else None),
        ("AppData (Roaming)", os.environ.get("APPDATA")),
        ("ProgramData", os.environ.get("PROGRAMDATA")),
        ("Program Files", os.environ.get("ProgramFiles")),
        ("Program Files (x86)", os.environ.get("ProgramFiles(x86)")),
    ]
    seen: set[str] = set()
    for label, raw in env_map:
        if not raw:
            continue
        try:
            p = Path(raw).resolve()
            key = str(p).lower()
            if p.is_dir() and key not in seen:
                seen.add(key)
                roots.append((label, p))
        except OSError:
            continue
    return roots


def scan_app_leftovers(
    app_id: str = "",
    app_name: str = "",
    publisher: str = "",
    install_location: str = "",
    search_roots: list[tuple[str, Path]] | None = None,
) -> dict[str, Any]:
    """Scans standard app-data/install directories and HKCU registry for leftover traces of an application.

    Distinguishes high-confidence matches from ambiguous/review-required matches and explains the evidence.
    """
    if app_id and not app_name:
        try:
            apps = list_apps()["apps"]
            matched = next((a for a in apps if a["id"] == app_id), None)
            if matched:
                app_name = app_name or matched.get("name", "")
                publisher = publisher or matched.get("publisher", "")
                install_location = install_location or matched.get("install_location", "") or matched.get("location", "")
        except Exception:
            pass

    clean_name = (app_name or "").strip()
    if len(clean_name) < 2:
        raise ValueError("Provide an application name (at least 2 characters) to scan for leftovers.")

    clean_pub = (publisher or "").strip()
    app_tokens = _extract_tokens(clean_name)
    pub_tokens = _extract_tokens(clean_pub)
    full_app_slug = re.sub(r"[^a-z0-9]+", "", clean_name.lower())
    full_pub_slug = re.sub(r"[^a-z0-9]+", "", clean_pub.lower())
    is_shared_vendor = clean_pub.lower() in GENERIC_SHARED_VENDORS or full_pub_slug in GENERIC_SHARED_VENDORS

    roots = search_roots if search_roots is not None else default_leftover_search_roots()
    root_paths_lower = {str(r.resolve()).lower() for _, r in roots if r.exists()}

    filesystem_leftovers: list[dict[str, Any]] = []
    seen_paths: set[str] = set()

    def _add_candidate(target: Path, location_group: str, confidence: str, evidence: str) -> None:
        try:
            resolved = target.resolve()
        except OSError:
            return
        key = str(resolved).lower()
        if key in seen_paths or key in root_paths_lower:
            return
        if len(resolved.parts) <= 2:
            return
        seen_paths.add(key)
        is_dir = resolved.is_dir()
        if is_dir:
            size_bytes, file_count = _bounded_dir_stats(resolved)
        else:
            try:
                size_bytes = resolved.stat().st_size
                file_count = 1
            except OSError:
                return
        try:
            mtime = resolved.stat().st_mtime
        except OSError:
            mtime = 0.0

        filesystem_leftovers.append(
            {
                "path": str(resolved),
                "name": resolved.name,
                "kind": "folder" if is_dir else "file",
                "location_group": location_group,
                "size_bytes": size_bytes,
                "file_count": file_count,
                "mtime": mtime,
                "confidence": confidence,
                "evidence": evidence,
            }
        )

    # 1. Check explicit InstallLocation if provided
    if install_location and install_location.strip():
        try:
            loc_path = Path(install_location.strip().strip('"'))
            if loc_path.suffix.lower() in {".exe", ".dll"}:
                loc_path = loc_path.parent
            if loc_path.exists() and loc_path.is_dir():
                resolved_loc = loc_path.resolve()
                if str(resolved_loc).lower() not in root_paths_lower and len(resolved_loc.parts) >= 3:
                    _add_candidate(
                        resolved_loc,
                        "Install Directory",
                        "high",
                        f"Matches registered InstallLocation for '{clean_name}'",
                    )
        except OSError:
            pass

    # 2. Scan candidate app-data & program directories (top-level + Vendor\App second level)
    primary_token = app_tokens[0] if app_tokens else ""
    for label, root_dir in roots:
        if not root_dir.exists() or not root_dir.is_dir():
            continue
        try:
            with os.scandir(root_dir) as it:
                for entry in it:
                    try:
                        entry_name = entry.name
                        entry_slug = re.sub(r"[^a-z0-9]+", "", entry_name.lower())
                        if not entry_slug:
                            continue
                        entry_path = Path(entry.path)

                        # Case A: Exact full app name match
                        if full_app_slug and len(full_app_slug) >= 3 and entry_slug == full_app_slug:
                            _add_candidate(
                                entry_path,
                                label,
                                "high",
                                f"Item in {label} exactly matches application name '{clean_name}'",
                            )
                            continue

                        # Case B: Entry matches publisher name -> inspect child directories for app match
                        if full_pub_slug and len(full_pub_slug) >= 3 and (
                            entry_slug == full_pub_slug or (pub_tokens and pub_tokens[0] in entry_name.lower())
                        ):
                            matched_sub = False
                            if entry.is_dir(follow_symlinks=False):
                                try:
                                    with os.scandir(entry_path) as sub_it:
                                        for sub in sub_it:
                                            sub_slug = re.sub(r"[^a-z0-9]+", "", sub.name.lower())
                                            if (full_app_slug and sub_slug == full_app_slug) or (
                                                primary_token and len(primary_token) >= 3 and primary_token in sub.name.lower()
                                            ):
                                                _add_candidate(
                                                    Path(sub.path),
                                                    label,
                                                    "high",
                                                    f"Nested under publisher folder '{entry_name}' and matches app '{clean_name}'",
                                                )
                                                matched_sub = True
                                except OSError:
                                    pass
                            if not matched_sub and not is_shared_vendor:
                                _add_candidate(
                                    entry_path,
                                    label,
                                    "review_required",
                                    f"Folder in {label} matches publisher '{clean_pub}'; verify no other apps from this publisher are installed",
                                )
                            continue

                        # Case C: Partial/token match on distinctive app token
                        if primary_token and len(primary_token) >= 4 and primary_token in entry_name.lower():
                            entry_tokens = _extract_tokens(entry_name)
                            exact_token_match = bool(app_tokens) and entry_tokens == app_tokens
                            conf = "high" if exact_token_match else "review_required"
                            ev = (
                                f"Name in {label} matches all tokens of '{clean_name}'"
                                if exact_token_match
                                else f"Name in {label} partially matches token '{primary_token}' — review before deleting"
                            )
                            _add_candidate(entry_path, label, conf, ev)
                    except OSError:
                        continue
        except OSError:
            continue

    # 3. Read-only Registry Leftover Inspection on Windows (HKCU\Software)
    registry_leftovers: list[dict[str, Any]] = []
    if sys.platform == "win32" and search_roots is None:
        try:
            import winreg

            candidates_to_check = []
            if clean_pub and clean_name:
                candidates_to_check.append((f"Software\\{clean_pub}\\{clean_name}", "high", f"Registry key matches Publisher '{clean_pub}' and App '{clean_name}'"))
            if clean_name:
                candidates_to_check.append((f"Software\\{clean_name}", "high", f"Registry key matches App '{clean_name}'"))
            if clean_pub and not is_shared_vendor:
                candidates_to_check.append((f"Software\\{clean_pub}", "review_required", f"Vendor key matches Publisher '{clean_pub}' (shared across vendor apps)"))

            seen_reg = set()
            for subkey, conf, ev in candidates_to_check:
                norm_k = subkey.lower()
                if norm_k in seen_reg:
                    continue
                try:
                    with winreg.OpenKey(winreg.HKEY_CURRENT_USER, subkey, 0, winreg.KEY_READ):
                        seen_reg.add(norm_k)
                        registry_leftovers.append(
                            {
                                "key": f"HKCU\\{subkey}",
                                "confidence": conf,
                                "evidence": ev,
                            }
                        )
                except OSError:
                    continue
        except Exception:
            pass

    filesystem_leftovers.sort(
        key=lambda item: (0 if item["confidence"] == "high" else 1, -item["size_bytes"], item["name"].lower())
    )

    total_bytes = sum(i["size_bytes"] for i in filesystem_leftovers)
    high_conf_bytes = sum(i["size_bytes"] for i in filesystem_leftovers if i["confidence"] == "high")

    return {
        "app_id": app_id,
        "app_name": clean_name,
        "publisher": clean_pub,
        "install_location": install_location,
        "leftovers": filesystem_leftovers,
        "registry_leftovers": registry_leftovers,
        "total_count": len(filesystem_leftovers),
        "high_confidence_count": sum(1 for i in filesystem_leftovers if i["confidence"] == "high"),
        "review_required_count": sum(1 for i in filesystem_leftovers if i["confidence"] != "high"),
        "total_reclaimable_bytes": total_bytes,
        "high_confidence_bytes": high_conf_bytes,
        "safety_notice": (
            "High-confidence items directly match the app's install path or vendor+app folder. "
            "Items marked 'review_required' partially match the app or publisher name and should be inspected before removal."
        ),
    }


def _leftover_allowed_roots(extra_roots: list[Path] | None = None) -> list[Path]:
    roots = [r for _, r in default_leftover_search_roots()]
    if extra_roots:
        roots.extend(extra_roots)
    return roots


def propose_leftover_cleanup(
    paths: list[str],
    mode: str = "recycle",
    extra_roots: list[Path] | None = None,
) -> dict[str, Any]:
    """Issues a confirmation token for removing selected application leftover files/folders."""
    from app.services.cleanup_service import CleanupService

    return CleanupService().propose_cleanup(
        paths=paths,
        mode=mode,
        extra_allowed_roots=_leftover_allowed_roots(extra_roots),
    )


def execute_leftover_cleanup(
    proposal: dict[str, Any],
    confirmation_token: str,
    extra_roots: list[Path] | None = None,
) -> dict[str, Any]:
    """Executes token-confirmed removal of application leftover files/folders."""
    from app.services.cleanup_service import CleanupService

    return CleanupService().execute_cleanup(
        proposal=proposal,
        confirmation_token=confirmation_token,
        extra_allowed_roots=_leftover_allowed_roots(extra_roots),
    )
