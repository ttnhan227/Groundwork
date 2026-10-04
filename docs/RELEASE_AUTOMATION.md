# Automatic Windows releases and website downloads

The release workflow is `.github/workflows/release.yml`. A stable tag push such as `v1.0.1` builds and tests the Windows app, then publishes its installer and checksum to GitHub Releases. You can also rerun an existing tag through **Actions → Publish Windows desktop release → Run workflow**.

## One-time activation

Push the repaired application and the new workflow to `ttnhan227/Groundwork`, and deploy the updated `client/` website once to the existing Render site at https://groundwork-client.onrender.com/. The release/download changes are currently in the local working tree; no remote release or deployment has been executed. The Render dashboard opened its sign-in page; authenticated deployment access is pending.

`render.yaml` specifies the existing `groundwork-client` static site, the `main` branch, and automatic deployment after CI checks pass. Sync the Blueprint or apply that setting to the existing service; this does not create a new hosting provider. Once this download-page change is deployed, future app releases update the download without another Render deployment.

The repository is public, so the browser can read public release metadata without a token. GitHub Actions publishes with its built-in `GITHUB_TOKEN`; do not put that token in the website. No publishing credentials are required in website code. Repository policies must allow the workflow's `contents: write` permission.

## Every subsequent app release

Commit and push the app changes, then create and push the desired version tag:

```powershell
git tag v1.0.1
git push origin v1.0.1
```

Use a new version for each release; `v1.0.1` is an example, not a tag created by this change. The tag must point to the complete repaired application, including packaging scripts and model preparation.

The workflow sets Tauri, Cargo, npm, and backend versions from that tag in the disposable build checkout. It builds the NSIS installer with bundled Python, Git, and local model files, runs local/cloud tests and frozen-core/scale/sync checks, then silently installs and exercises the app in its actual WebView2. A failed check prevents publication.

After successful checks, the publish job verifies the SHA-256 checksum, uploads `Groundwork-windows-x64-setup.exe` and its `.sha256` file into a draft release, then publishes it. Existing public releases cannot be overwritten by a rerun. An older-version backport does not replace a newer latest release.

## Website behavior

The download page queries `https://api.github.com/repos/ttnhan227/Groundwork/releases/latest` at runtime. It uses the exact uploaded asset's URL, version, size, and GitHub-provided SHA-256 digest. Drafts, prereleases, incomplete uploads, and URLs outside this repository are excluded. The checksum file is also available on the release page if the API digest is absent.

There is no per-release `VITE_WINDOWS_INSTALLER_URL` or checksum edit, file upload, or website deployment. Refreshing or opening the download page obtains the latest published stable app. This changes website downloads; it does not add an automatic updater inside already-installed desktop apps.

GitHub may briefly cache its latest-release response. Unauthenticated API rate limits or an outage show an explicit error and a direct releases-page link; the website does not claim an unverified version is current. Do not mark unrelated non-desktop releases as latest, since the latest release must include the stable installer asset.

## Verification

- Website production build passed.
- Four release metadata/API tests passed, covering uploaded assets, version/size/checksum, missing releases, service failure, and untrusted URLs.
- Version preparation was tested in an isolated checkout fixture.
- Browser workflow test covers a newer version appearing without a rebuild, unpublished releases, and API outages.
- The actual GitHub-hosted release job and public website deployment have not been run from this session. The Windows application build/installed workflow was verified separately during the repair.

The existing installer remains unsigned. Release automation does not provide a code-signing identity.
