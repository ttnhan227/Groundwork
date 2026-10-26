# Changelog

All notable changes to **Groundwork** are documented in this file.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [1.0.0] - 2026-10-26

### First Release

- Native WinUI 3 Windows desktop app with local-first storage scanning, system diagnostics, and a grounded AI assistant (Ollama, Gemini, OpenAI, or Mistral). When a question needs web search and search is off, the agent says so instead of answering from memory.
- Structured system inventory context, cached locally with identifying serial, MAC, host, and user fields removed.
- Windows CPU, memory, GPU-engine, and disk-I/O measurements, restart indicators, and device error reporting.
- Safe cleanup: leftover inspection after uninstall, validated recursive-size proposals, and mandatory confirmation for permanent deletion.
- Windows installer with a version-specific filename and an update or uninstall choice when Groundwork is already installed.
- Portable ZIP and SHA-256 checksums published with each GitHub Release.
