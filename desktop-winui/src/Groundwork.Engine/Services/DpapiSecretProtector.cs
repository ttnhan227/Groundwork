using System;
using System.Runtime.InteropServices;
using System.Text;

namespace Groundwork.Engine.Services;

/// <summary>
/// Encrypts and decrypts sensitive strings (such as AI provider API keys) at rest using
/// Windows Data Protection API (DPAPI / crypt32.dll) scoped to the current Windows user.
/// </summary>
public static class DpapiSecretProtector
{
    public const string EncryptedPrefix = "dpapi:";
    private const uint CRYPTPROTECT_UI_FORBIDDEN = 0x1;

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct DATA_BLOB
    {
        public int cbData;
        public IntPtr pbData;
    }

    [DllImport("crypt32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    private static extern bool CryptProtectData(
        ref DATA_BLOB pDataIn,
        string? szDataDescr,
        IntPtr pOptionalEntropy,
        IntPtr pvReserved,
        IntPtr pPromptStruct,
        uint dwFlags,
        out DATA_BLOB pDataOut);

    [DllImport("crypt32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    private static extern bool CryptUnprotectData(
        ref DATA_BLOB pDataIn,
        IntPtr ppszDataDescr,
        IntPtr pOptionalEntropy,
        IntPtr pvReserved,
        IntPtr pPromptStruct,
        uint dwFlags,
        out DATA_BLOB pDataOut);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern IntPtr LocalFree(IntPtr hMem);

    public static bool IsEncrypted(string? value) =>
        !string.IsNullOrWhiteSpace(value) && value.StartsWith(EncryptedPrefix, StringComparison.Ordinal);

    public static string Protect(string? plainText)
    {
        if (string.IsNullOrEmpty(plainText))
        {
            return string.Empty;
        }

        if (IsEncrypted(plainText))
        {
            return plainText;
        }

        if (!OperatingSystem.IsWindows())
        {
            return plainText;
        }

        var bytes = Encoding.UTF8.GetBytes(plainText);
        var inBlob = new DATA_BLOB();
        var outBlob = new DATA_BLOB();

        try
        {
            inBlob.cbData = bytes.Length;
            inBlob.pbData = Marshal.AllocHGlobal(bytes.Length);
            Marshal.Copy(bytes, 0, inBlob.pbData, bytes.Length);

            if (!CryptProtectData(
                    ref inBlob,
                    "GroundworkCredential",
                    IntPtr.Zero,
                    IntPtr.Zero,
                    IntPtr.Zero,
                    CRYPTPROTECT_UI_FORBIDDEN,
                    out outBlob))
            {
                return plainText;
            }

            var cipherBytes = new byte[outBlob.cbData];
            Marshal.Copy(outBlob.pbData, cipherBytes, 0, outBlob.cbData);
            return EncryptedPrefix + Convert.ToBase64String(cipherBytes);
        }
        catch
        {
            return plainText;
        }
        finally
        {
            if (inBlob.pbData != IntPtr.Zero)
            {
                Marshal.FreeHGlobal(inBlob.pbData);
            }
            if (outBlob.pbData != IntPtr.Zero)
            {
                LocalFree(outBlob.pbData);
            }
        }
    }

    public static string Unprotect(string? storedValue)
    {
        if (string.IsNullOrEmpty(storedValue))
        {
            return string.Empty;
        }

        if (!IsEncrypted(storedValue))
        {
            // Transparent backward compatibility for existing plaintext settings before next save.
            return storedValue;
        }

        if (!OperatingSystem.IsWindows())
        {
            return string.Empty;
        }

        var base64 = storedValue[EncryptedPrefix.Length..];
        var inBlob = new DATA_BLOB();
        var outBlob = new DATA_BLOB();

        try
        {
            var cipherBytes = Convert.FromBase64String(base64);
            inBlob.cbData = cipherBytes.Length;
            inBlob.pbData = Marshal.AllocHGlobal(cipherBytes.Length);
            Marshal.Copy(cipherBytes, 0, inBlob.pbData, cipherBytes.Length);

            if (!CryptUnprotectData(
                    ref inBlob,
                    IntPtr.Zero,
                    IntPtr.Zero,
                    IntPtr.Zero,
                    IntPtr.Zero,
                    CRYPTPROTECT_UI_FORBIDDEN,
                    out outBlob))
            {
                return string.Empty;
            }

            var plainBytes = new byte[outBlob.cbData];
            Marshal.Copy(outBlob.pbData, plainBytes, 0, outBlob.cbData);
            return Encoding.UTF8.GetString(plainBytes);
        }
        catch
        {
            return string.Empty;
        }
        finally
        {
            if (inBlob.pbData != IntPtr.Zero)
            {
                Marshal.FreeHGlobal(inBlob.pbData);
            }
            if (outBlob.pbData != IntPtr.Zero)
            {
                LocalFree(outBlob.pbData);
            }
        }
    }
}
