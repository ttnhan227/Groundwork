"""On-demand storage allocation; never reads contents or walks directories."""
import ctypes
import os
from ctypes import wintypes
from pathlib import Path


def file_storage(path: Path):
    stat = path.stat()
    if not path.is_file():
        raise FileNotFoundError(str(path))
    result = {"logical_bytes": stat.st_size, "allocated_bytes": None,
              "hard_links": stat.st_nlink, "allocation_note": "Allocation information is unavailable."}
    if os.name != "nt":
        if hasattr(stat, "st_blocks"):
            result.update(allocated_bytes=stat.st_blocks * 512, allocation_note="Primary file stream; filesystem metadata is excluded.")
        return result
    attributes = getattr(stat, "st_file_attributes", 0)
    if attributes & (0x1000 | 0x40000 | 0x400000):
        result["allocation_note"] = "Cloud placeholder: allocation was not queried to avoid downloading the file."
        return result
    class StandardInfo(ctypes.Structure):
        _fields_ = [("allocation", ctypes.c_longlong), ("eof", ctypes.c_longlong),
                    ("links", wintypes.DWORD), ("delete_pending", ctypes.c_ubyte), ("directory", ctypes.c_ubyte)]
    kernel = ctypes.WinDLL("kernel32", use_last_error=True)
    kernel.CreateFileW.argtypes = [wintypes.LPCWSTR, wintypes.DWORD, wintypes.DWORD, ctypes.c_void_p, wintypes.DWORD, wintypes.DWORD, wintypes.HANDLE]
    kernel.CreateFileW.restype = wintypes.HANDLE
    kernel.GetFileInformationByHandleEx.argtypes = [wintypes.HANDLE, ctypes.c_int, ctypes.c_void_p, wintypes.DWORD]
    kernel.GetFileInformationByHandleEx.restype = wintypes.BOOL
    kernel.CloseHandle.argtypes = [wintypes.HANDLE]
    filename = str(path.resolve())
    if not filename.startswith("\\\\?\\"):
        filename = "\\\\?\\UNC\\" + filename[2:] if filename.startswith("\\\\") else "\\\\?\\" + filename
    handle = kernel.CreateFileW(filename, 0x80, 7, None, 3, 0x200000, None)
    if handle == ctypes.c_void_p(-1).value:
        raise ctypes.WinError(ctypes.get_last_error())
    try:
        info = StandardInfo()
        if not kernel.GetFileInformationByHandleEx(handle, 1, ctypes.byref(info), ctypes.sizeof(info)):
            raise ctypes.WinError(ctypes.get_last_error())
        result.update(logical_bytes=info.eof, allocated_bytes=info.allocation, hard_links=info.links,
                      allocation_note="Primary file stream; named streams and filesystem metadata are excluded. Hard links share this allocation.")
        if attributes & (0x200 | 0x800):  # sparse / compressed
            # Standard allocation can include reserved sparse ranges. Query
            # the storage actually committed for compressed/sparse streams.
            kernel.GetCompressedFileSizeW.argtypes = [wintypes.LPCWSTR, ctypes.POINTER(wintypes.DWORD)]
            kernel.GetCompressedFileSizeW.restype = wintypes.DWORD
            high = wintypes.DWORD()
            ctypes.set_last_error(0)
            low = kernel.GetCompressedFileSizeW(filename, ctypes.byref(high))
            if low == 0xFFFFFFFF and ctypes.get_last_error():
                raise ctypes.WinError(ctypes.get_last_error())
            result["allocated_bytes"] = (high.value << 32) | low
    finally:
        kernel.CloseHandle(handle)
    return result
