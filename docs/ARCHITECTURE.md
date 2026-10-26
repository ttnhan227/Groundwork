# Architecture

Groundwork is a native Windows desktop application. All analysis runs in-process; there is no bundled Python runtime, local server or hosted backend.

- **`desktop-winui/src/Groundwork.Desktop`** — the WinUI 3 user interface.
- **`desktop-winui/src/Groundwork.Engine`** — the C# engine for storage scanning, hardware and installed-app inspection, safety checks, and cleanup proposals. It is covered by the unit tests in `desktop-winui`.
- **`desktop-winui/src/Groundwork.MftHelper`** — an elevated helper used for fast NTFS MFT scanning.
- **AI providers** — the app calls Ollama (local, default `http://127.0.0.1:11434`), Google Gemini or OpenAI directly over HTTP, according to the user's settings.
- **`desktop-winui/installer`** — the Inno Setup script. It produces the versioned installer, detects an existing installation and offers update or uninstall.

The static website in `client/` owns marketing and documentation. It is hosted on Render and reads the installer URL, version, size and checksum from the newest published GitHub release at runtime. It does not host a workspace backend and does not invent download artifacts.

## Build, test and release

- `.github/scripts/build-windows-release.ps1` runs the .NET tests, publishes the desktop app and MFT helper, builds the installer and portable ZIP contents, and writes checksums.
- The `CI` workflow builds and tests the Windows app and the website on pushes and pull requests, then deploys and verifies the website on `main`.
- The tag-triggered `Publish Windows desktop release` workflow builds the release and publishes the installer, portable ZIP and checksums to GitHub Releases. See [RELEASE_AUTOMATION.md](RELEASE_AUTOMATION.md) for release steps.
