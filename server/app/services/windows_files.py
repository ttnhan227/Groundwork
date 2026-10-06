"""Windows copies preserve streams, attributes and security before source deletion."""
import ctypes
import hashlib
import os
from ctypes import wintypes


def stream_hashes(path):
    if os.name != "nt":
        return {}
    kernel = ctypes.WinDLL("kernel32", use_last_error=True)
    class StreamData(ctypes.Structure):
        _fields_ = [("size", ctypes.c_longlong), ("name", wintypes.WCHAR * 296)]
    first = kernel.FindFirstStreamW
    first.argtypes = [wintypes.LPCWSTR, ctypes.c_int, ctypes.POINTER(StreamData), wintypes.DWORD]
    first.restype = wintypes.HANDLE
    next_stream = kernel.FindNextStreamW
    next_stream.argtypes = [wintypes.HANDLE, ctypes.POINTER(StreamData)]
    next_stream.restype = wintypes.BOOL
    kernel.FindClose.argtypes = [wintypes.HANDLE]
    data = StreamData()
    handle = first(str(path), 0, ctypes.byref(data), 0)
    if handle == ctypes.c_void_p(-1).value:
        error = ctypes.get_last_error()
        if error in {38, 87}:  # no streams / filesystem doesn't support named streams
            return {}
        raise ctypes.WinError(error)
    result = {}
    try:
        while True:
            if data.name != "::$DATA":
                digest = hashlib.sha256()
                with open(str(path) + data.name, "rb") as source:
                    while block := source.read(1024 * 1024):
                        digest.update(block)
                result[data.name] = digest.hexdigest()
            if not next_stream(handle, ctypes.byref(data)):
                if ctypes.get_last_error() != 38:
                    raise ctypes.WinError(ctypes.get_last_error())
                break
    finally:
        kernel.FindClose(handle)
    return result


def security_descriptor(path):
    api = ctypes.WinDLL("advapi32", use_last_error=True)
    get_security = api.GetFileSecurityW
    get_security.argtypes = [wintypes.LPCWSTR, wintypes.DWORD, ctypes.c_void_p, wintypes.DWORD, ctypes.POINTER(wintypes.DWORD)]
    get_security.restype = wintypes.BOOL
    needed = wintypes.DWORD()
    get_security(str(path), 7, None, 0, ctypes.byref(needed))
    if not needed.value:
        raise ctypes.WinError(ctypes.get_last_error())
    descriptor = ctypes.create_string_buffer(needed.value)
    if not get_security(str(path), 7, descriptor, needed, ctypes.byref(needed)):
        raise ctypes.WinError(ctypes.get_last_error())
    return descriptor


def copy_preserving(source, target, cancelled, progress):
    kernel = ctypes.WinDLL("kernel32", use_last_error=True)
    callback_type = ctypes.WINFUNCTYPE(wintypes.DWORD, ctypes.c_longlong, ctypes.c_longlong, ctypes.c_longlong, ctypes.c_longlong, wintypes.DWORD, wintypes.DWORD, wintypes.HANDLE, wintypes.HANDLE, ctypes.c_void_p)
    started = [False]
    @callback_type
    def callback(total, transferred, stream_total, stream_transferred, stream_number, reason, source_handle, target_handle, context):
        started[0] = True
        progress(transferred, total)
        return 1 if cancelled() else 0
    copy = kernel.CopyFileExW
    copy.argtypes = [wintypes.LPCWSTR, wintypes.LPCWSTR, callback_type, ctypes.c_void_p, ctypes.POINTER(wintypes.BOOL), wintypes.DWORD]
    copy.restype = wintypes.BOOL
    cancel = wintypes.BOOL(False)
    if cancelled():
        raise InterruptedError("File operation cancelled. Original retained.")
    if not copy(str(source), str(target), callback, None, ctypes.byref(cancel), 1):
        error = InterruptedError("File operation cancelled. Original retained.") if cancelled() else ctypes.WinError(ctypes.get_last_error())
        error.destination_created = started[0]
        raise error
    try:
        _copy_times(source, target)
        _copy_security(source, target)
    except Exception as error:
        error.destination_created = True
        raise


def _copy_times(source, target):
    kernel = ctypes.WinDLL("kernel32", use_last_error=True)
    create = kernel.CreateFileW
    create.argtypes = [wintypes.LPCWSTR, wintypes.DWORD, wintypes.DWORD, ctypes.c_void_p, wintypes.DWORD, wintypes.DWORD, wintypes.HANDLE]
    create.restype = wintypes.HANDLE
    kernel.GetFileTime.argtypes = [wintypes.HANDLE, ctypes.POINTER(wintypes.FILETIME), ctypes.POINTER(wintypes.FILETIME), ctypes.POINTER(wintypes.FILETIME)]
    kernel.SetFileTime.argtypes = kernel.GetFileTime.argtypes
    kernel.CloseHandle.argtypes = [wintypes.HANDLE]
    created, accessed, written = wintypes.FILETIME(), wintypes.FILETIME(), wintypes.FILETIME()
    for path, access, operation in [(source, 0x80, kernel.GetFileTime), (target, 0x100, kernel.SetFileTime)]:
        handle = create(str(path), access, 7, None, 3, 0, None)
        if handle == ctypes.c_void_p(-1).value:
            raise ctypes.WinError(ctypes.get_last_error())
        try:
            if not operation(handle, ctypes.byref(created), ctypes.byref(accessed), ctypes.byref(written)):
                raise ctypes.WinError(ctypes.get_last_error())
        finally:
            kernel.CloseHandle(handle)


def _copy_security(source, target):
    descriptor = security_descriptor(source)
    api = ctypes.WinDLL("advapi32", use_last_error=True)
    control, revision = wintypes.WORD(), wintypes.DWORD()
    api.GetSecurityDescriptorControl.argtypes = [ctypes.c_void_p, ctypes.POINTER(wintypes.WORD), ctypes.POINTER(wintypes.DWORD)]
    if not api.GetSecurityDescriptorControl(descriptor, ctypes.byref(control), ctypes.byref(revision)):
        raise ctypes.WinError(ctypes.get_last_error())
    set_security = api.SetFileSecurityW
    set_security.argtypes = [wintypes.LPCWSTR, wintypes.DWORD, ctypes.c_void_p]
    set_security.restype = wintypes.BOOL
    # Preserve DACL protection/inheritance as well as owner, group and permissions.
    flags = 7 | (0x80000000 if control.value & 0x1000 else 0x20000000)
    if not set_security(str(target), flags, descriptor):
        error = OSError("Windows couldn't preserve file permissions. Original retained.")
        error.destination_created = True
        raise error
