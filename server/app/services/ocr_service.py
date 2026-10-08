"""Local Windows OCR. Image text is evidence, never visual scene understanding."""
import base64
import os
from pathlib import Path
import subprocess
import tempfile

SCRIPT = r'''
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$null = [Windows.Storage.StorageFile, Windows.Storage, ContentType=WindowsRuntime]
$null = [Windows.Graphics.Imaging.BitmapDecoder, Windows.Graphics.Imaging, ContentType=WindowsRuntime]
$null = [Windows.Media.Ocr.OcrEngine, Windows.Foundation, ContentType=WindowsRuntime]
$asTask = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.IsGenericMethod -and $_.GetParameters().Count -eq 1 } | Select-Object -First 1
function Await($operation, $type) {
  $task = $asTask.MakeGenericMethod($type).Invoke($null, @($operation))
  $task.Wait()
  $task.Result
}
$file = Await ([Windows.Storage.StorageFile]::GetFileFromPathAsync($env:GROUNDWORK_OCR_INPUT)) ([Windows.Storage.StorageFile])
$stream = Await ($file.OpenAsync([Windows.Storage.FileAccessMode]::Read)) ([Windows.Storage.Streams.IRandomAccessStream])
try {
  $decoder = Await ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])
  $bitmap = Await ($decoder.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])
  try {
    $engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages()
    if (!$engine) { throw 'No Windows OCR language is installed.' }
    $result = Await ($engine.RecognizeAsync($bitmap)) ([Windows.Media.Ocr.OcrResult])
    $text = ($result.Lines | ForEach-Object { $_.Text }) -join "`n"
    [IO.File]::WriteAllText($env:GROUNDWORK_OCR_OUTPUT, $text, [Text.Encoding]::UTF8)
  } finally { $bitmap.Dispose() }
} finally { $stream.Dispose() }
'''


def available() -> bool:
    return os.name == 'nt'


def read_image(path: Path) -> str:
    if not available():
        raise ValueError('Local image text recognition is available on Windows only.')
    from PIL import Image, ImageOps
    with tempfile.TemporaryDirectory(prefix='groundwork-ocr-') as folder:
        input_path = Path(folder) / 'input.png'
        output_path = Path(folder) / 'text.txt'
        with Image.open(path) as original:
            if original.width * original.height > 40_000_000:
                raise ValueError('Image exceeds the OCR dimensions limit.')
            image = ImageOps.exif_transpose(original).convert('RGB')
            image.thumbnail((2400, 2400))
            image.save(input_path)
        env = dict(os.environ, GROUNDWORK_OCR_INPUT=str(input_path), GROUNDWORK_OCR_OUTPUT=str(output_path))
        encoded = base64.b64encode(SCRIPT.encode('utf-16-le')).decode('ascii')
        try:
            run = subprocess.run(['powershell.exe', '-NoProfile', '-NonInteractive', '-EncodedCommand', encoded], env=env, capture_output=True, timeout=25, creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
        except subprocess.TimeoutExpired as exc:
            raise ValueError('Image text recognition took too long. Try a smaller image.') from exc
        if run.returncode or not output_path.exists():
            raise ValueError('Windows could not read image text. Check that an OCR language is installed in Windows Settings.')
        return output_path.read_text(encoding='utf-8-sig')[:100_000]
