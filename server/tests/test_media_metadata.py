import struct
from pathlib import Path

from app.services.media_metadata import CapabilitiesService, read_audio_metadata


def test_capabilities_registry_shows_deferred_models():
    caps = CapabilitiesService.get_capabilities()
    assert caps["text_indexing"]["available"] is True
    assert caps["pdf_text"]["available"] is True
    assert caps["audio_metadata"]["available"] is True
    import os
    assert caps["image_ocr"]["available"] is (os.name == 'nt')
    assert caps["image_ocr"]["status"] == ('available' if os.name == 'nt' else 'unavailable')
    assert caps["image_understanding"]["available"] is False
    assert caps["image_understanding"]["status"] == "deferred"
    assert caps["audio_transcription"]["available"] is False
    assert caps["audio_transcription"]["status"] == "deferred"


def test_read_audio_metadata_wav(tmp_path):
    wav_path = tmp_path / "sample.wav"
    # Construct a minimal RIFF WAVE header with 44100 Hz, 1 channel, 16-bit PCM, 44100 samples (1.0 second)
    channels = 1
    sample_rate = 44100
    bits_per_sample = 16
    byte_rate = sample_rate * channels * (bits_per_sample // 8)
    block_align = channels * (bits_per_sample // 8)
    data_size = sample_rate * block_align  # 1 sec

    riff_header = b"RIFF" + struct.pack("<I", 36 + data_size) + b"WAVE"
    fmt_chunk = b"fmt " + struct.pack("<IHHIIHH", 16, 1, channels, sample_rate, byte_rate, block_align, bits_per_sample)
    data_chunk = b"data" + struct.pack("<I", data_size) + (b"\x00" * data_size)

    wav_path.write_bytes(riff_header + fmt_chunk + data_chunk)

    meta = read_audio_metadata(wav_path)
    assert meta["format"] == "wav"
    assert meta["duration_seconds"] == 1.0
    assert meta["is_read_only"] is True
    assert meta.get("artist") is None


def test_read_audio_metadata_id3v1_mp3(tmp_path):
    mp3_path = tmp_path / "song.mp3"
    # Create a 256-byte dummy mp3 with ID3v1 trailer
    content = bytearray(256)
    # ID3v1 tag structure at last 128 bytes
    tag = bytearray(128)
    tag[:3] = b"TAG"
    tag[3:33] = b"Test Song".ljust(30, b"\x00")
    tag[33:63] = b"Test Artist".ljust(30, b"\x00")
    tag[63:93] = b"Test Album".ljust(30, b"\x00")
    tag[125] = 0
    tag[126] = 5  # track 5
    content[-128:] = tag
    mp3_path.write_bytes(bytes(content))

    meta = read_audio_metadata(mp3_path)
    assert meta["format"] == "mp3"
    assert meta["title"] == "Test Song"
    assert meta["artist"] == "Test Artist"
    assert meta["album"] == "Test Album"
    assert meta["track_number"] == "5"
    assert meta["is_read_only"] is True
