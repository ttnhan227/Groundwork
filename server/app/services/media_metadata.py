"""Read-only media metadata extraction and capability registry.

Extracts standard read-only tags (artist, album, track number, title) without
attempting audio content understanding, genre/BPM inference, or voice analysis.
Unsupported vision and speech models remain explicitly unavailable.
"""

from __future__ import annotations

import os
import struct
from pathlib import Path


class CapabilitiesService:
    @staticmethod
    def get_capabilities() -> dict[str, dict]:
        return {
            "text_indexing": {
                "available": True,
                "label": "Text & Code Browsing",
                "description": "Fast keyword search, file browsing, and line-indexed reading for text, code, and configs.",
            },
            "pdf_text": {
                "available": True,
                "label": "PDF Text Extraction",
                "description": "Extracts selectable text and page structure from PDFs without OCR.",
            },
            "audio_metadata": {
                "available": True,
                "label": "Read-Only Audio Metadata",
                "description": "Reads standard tags (artist, album, track number, title, duration) from audio headers.",
            },
            "image_ocr": {
                "available": False,
                "status": "deferred",
                "label": "Image OCR",
                "description": "Extracting text from images and scanned documents requires a separate OCR engine.",
            },
            "image_understanding": {
                "available": False,
                "status": "deferred",
                "label": "Image Understanding",
                "description": "Visual scene and screenshot understanding requires a separate vision model.",
            },
            "audio_transcription": {
                "available": False,
                "status": "deferred",
                "label": "Speech Transcription",
                "description": "Local audio and video speech-to-text transcription requires a dedicated transcription model.",
            },
        }


def read_audio_metadata(path: Path) -> dict:
    """Extracts read-only audio metadata from audio headers.
    Never claims to infer genre, BPM, musical attributes, or speaker identity.
    """
    ext = path.suffix.lower()
    meta = {
        "format": ext.lstrip("."),
        "title": None,
        "artist": None,
        "album": None,
        "track_number": None,
        "duration_seconds": None,
        "is_read_only": True,
    }
    if not path.is_file():
        return meta

    try:
        if ext == ".mp3":
            _parse_mp3(path, meta)
        elif ext == ".wav":
            _parse_wav(path, meta)
        elif ext in {".flac", ".ogg"}:
            _parse_vorbis(path, meta)
    except Exception:
        # File parsing error or unusual header; gracefully return whatever was parsed
        pass

    return meta


def _parse_wav(path: Path, meta: dict) -> None:
    with path.open("rb") as f:
        riff = f.read(12)
        if len(riff) < 12 or riff[:4] != b"RIFF" or riff[8:12] != b"WAVE":
            return
        while chunk := f.read(8):
            if len(chunk) < 8:
                break
            chunk_id, chunk_size = struct.unpack("<4sI", chunk)
            if chunk_id == b"fmt ":
                fmt_data = f.read(chunk_size)
                if len(fmt_data) >= 16:
                    audio_format, channels, sample_rate, byte_rate, block_align, bits_per_sample = struct.unpack(
                        "<HHIIHH", fmt_data[:16]
                    )
                    meta["channels"] = channels
                    meta["sample_rate"] = sample_rate
            elif chunk_id == b"data":
                if meta.get("sample_rate") and meta.get("channels") and bits_per_sample:
                    bytes_per_sample = bits_per_sample // 8
                    if bytes_per_sample and channels:
                        total_samples = chunk_size // (channels * bytes_per_sample)
                        meta["duration_seconds"] = round(total_samples / meta["sample_rate"], 2)
                f.seek(chunk_size, os.SEEK_CUR)
            else:
                f.seek(chunk_size, os.SEEK_CUR)


def _parse_mp3(path: Path, meta: dict) -> None:
    with path.open("rb") as f:
        header = f.read(10)
        if len(header) >= 10 and header[:3] == b"ID3":
            major_version = header[3]
            # synchsafe integer tag size
            tag_size = (
                (header[6] & 0x7F) << 21
                | (header[7] & 0x7F) << 14
                | (header[8] & 0x7F) << 7
                | (header[9] & 0x7F)
            )
            data = f.read(min(tag_size, 256 * 1024))
            pos = 0
            while pos < len(data) - 10:
                frame_id = data[pos : pos + 4]
                if not frame_id.isalnum():
                    break
                if major_version == 4:
                    frame_size = (
                        (data[pos + 4] & 0x7F) << 21
                        | (data[pos + 5] & 0x7F) << 14
                        | (data[pos + 6] & 0x7F) << 7
                        | (data[pos + 7] & 0x7F)
                    )
                else:
                    frame_size = struct.unpack(">I", data[pos + 4 : pos + 8])[0]
                pos += 10
                if frame_size > len(data) - pos or frame_size <= 0:
                    break
                frame_data = data[pos : pos + frame_size]
                pos += frame_size

                val = _decode_id3_text(frame_data)
                if frame_id == b"TIT2":
                    meta["title"] = val
                elif frame_id == b"TPE1":
                    meta["artist"] = val
                elif frame_id == b"TALB":
                    meta["album"] = val
                elif frame_id == b"TRCK":
                    meta["track_number"] = val.split("/")[0].strip()

        # Check for ID3v1 at end of file if not populated
        if not meta["title"]:
            try:
                f.seek(-128, os.SEEK_END)
                v1 = f.read(128)
                if len(v1) == 128 and v1[:3] == b"TAG":
                    title = v1[3:33].strip(b"\x00 \t\r\n").decode("latin-1", errors="ignore")
                    artist = v1[33:63].strip(b"\x00 \t\r\n").decode("latin-1", errors="ignore")
                    album = v1[63:93].strip(b"\x00 \t\r\n").decode("latin-1", errors="ignore")
                    if title:
                        meta["title"] = title
                    if artist:
                        meta["artist"] = artist
                    if album:
                        meta["album"] = album
                    if v1[125] == 0:
                        meta["track_number"] = str(v1[126])
            except OSError:
                pass


def _decode_id3_text(data: bytes) -> str:
    if not data:
        return ""
    encoding = data[0]
    raw = data[1:]
    try:
        if encoding == 0:
            return raw.decode("latin-1", errors="ignore").strip("\x00 \t\r\n")
        elif encoding in (1, 2):
            return raw.decode("utf-16", errors="ignore").strip("\x00 \t\r\n")
        elif encoding == 3:
            return raw.decode("utf-8", errors="ignore").strip("\x00 \t\r\n")
        else:
            return raw.decode("utf-8", errors="ignore").strip("\x00 \t\r\n")
    except Exception:
        return ""


def _parse_vorbis(path: Path, meta: dict) -> None:
    # Read first 64KB looking for Vorbis comment markers
    with path.open("rb") as f:
        sample = f.read(64 * 1024)
        for field, key in [
            (b"TITLE=", "title"),
            (b"ARTIST=", "artist"),
            (b"ALBUM=", "album"),
            (b"TRACKNUMBER=", "track_number"),
        ]:
            idx = sample.find(field)
            if idx != -1:
                end = sample.find(b"\n", idx)
                if end == -1:
                    end = idx + 100
                val = sample[idx + len(field) : end].decode("utf-8", errors="ignore").strip("\x00 \t\r\n")
                if val:
                    meta[key] = val
