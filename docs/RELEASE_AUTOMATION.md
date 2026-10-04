# Automatic Windows releases and website downloads

The release workflow is `.github/workflows/release.yml`. A version tag push such as `v0.1.1` builds and tests the Windows app, then publishes its installer and checksum to GitHub Releases. You can also rerun an existing tag through **Actions → Publish Windows desktop release → Run workflow**.

## One-time activation

The repaired application and release workflow are pushed to `ttnhan227/Groundwork`. The updated website is deployed at https://groundwork-client.onrender.com/download. Render deployment `dep-db0qb1hsrm7s738o3bk0` successfully deployed commit `2c2ebbb` on 2026-10-04. The existing service is configured for automatic deployment after CI checks pass and a `/*` to `/index.html` rewrite; the direct download route returns HTTP 200.

`render.yaml` specifies the existing `groundwork-client` static site, the `main` branch, and automatic deployment after CI checks pass. These settings have been applied to the existing service. Once this download-page change is deployed, future app releases update the download without another Render deployment.

The repository is public, so the browser can read public release metadata without a token. GitHub Actions publishes with its built-in `GITHUB_TOKEN`; do not put that token in the website. No publishing credentials are required in website code. Repository policies must allow the workflow's `contents: write` permission.

## Every subsequent app release

Commit and push the app changes, then create and push the desired version tag:

```powershell
git tag v0.1.1
git push origin v0.1.1
```

Use a new version for each release; `v0.1.1` is an example, not a tag created by this change. The tag must point to the complete repaired application, including packaging scripts and model preparation.

The workflow sets Tauri, Cargo, npm, and backend versions from that tag in the disposable build checkout. It builds the NSIS installer with bundled Python, Git, and local model files, runs local/cloud tests and frozen-core/scale/sync checks, then silently installs and exercises the app in its actual WebView2. A failed check prevents publication.

After successful checks, the publish job verifies the SHA-256 checksum, uploads `Groundwork-windows-x64-setup.exe` and its `.sha256` file into a draft release, then publishes it. Existing public releases cannot be overwritten by a rerun. An older-version backport does not replace a newer latest release.

## Website behavior

The download page queries `https://api.github.com/repos/ttnhan227/Groundwork/releases?per_page=100` at runtime. It uses the exact uploaded asset's URL, version, size, and GitHub-provided SHA-256 digest. Drafts, incomplete uploads, and URLs outside this repository are excluded. Published 0.x versions are marked Preview on GitHub and the website; 1.0.0 is reserved for the finished product. The checksum file is also available on the release page if the API digest is absent.

There is no per-release `VITE_WINDOWS_INSTALLER_URL` or checksum edit, file upload, or website deployment. Refreshing or opening the download page obtains the newest published app. This changes website downloads; it does not add an automatic updater inside already-installed desktop apps.

GitHub may briefly cache its release-list response. Unauthenticated API rate limits or an outage show an explicit error and a direct releases-page link; the website does not claim an unverified version is current. Only releases containing a completed Windows installer are offered. Versions are compared numerically.

## Verification and status

Release checks cover metadata parsing, automatic version selection, installer version consistency, packaged startup, and installed-app workflows. Passing these checks does not mean the product is finished. Groundwork remains a 0.x preview until a deliberate 1.0 launch.

The installer remains unsigned. Release automation does not provide a code-signing identity.
