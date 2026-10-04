# Automatic Windows releases and website downloads

The release workflow is `.github/workflows/release.yml`. A stable tag push such as `v1.0.5` builds and tests the Windows app, then publishes its installer and checksum to GitHub Releases. You can also rerun an existing tag through **Actions → Publish Windows desktop release → Run workflow**.

## One-time activation

The repaired application and release workflow are pushed to `ttnhan227/Groundwork`. The updated website is deployed at https://groundwork-client.onrender.com/download. Render deployment `dep-db0qb1hsrm7s738o3bk0` successfully deployed commit `2c2ebbb` on 2026-10-04. The existing service is configured for automatic deployment after CI checks pass and a `/*` to `/index.html` rewrite; the direct download route returns HTTP 200.

`render.yaml` specifies the existing `groundwork-client` static site, the `main` branch, and automatic deployment after CI checks pass. These settings have been applied to the existing service. Once this download-page change is deployed, future app releases update the download without another Render deployment.

The repository is public, so the browser can read public release metadata without a token. GitHub Actions publishes with its built-in `GITHUB_TOKEN`; do not put that token in the website. No publishing credentials are required in website code. Repository policies must allow the workflow's `contents: write` permission.

## Every subsequent app release

Commit and push the app changes, then create and push the desired version tag:

```powershell
git tag v1.0.5
git push origin v1.0.5
```

Use a new version for each release; `v1.0.5` is an example, not a tag created by this change. The tag must point to the complete repaired application, including packaging scripts and model preparation.

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
- Hosted release workflow passed: https://github.com/ttnhan227/Groundwork/actions/runs/37168838788. It published the first verified public installer as `v1.0.4` on 2026-10-04.
- Main CI passed all five jobs: https://github.com/ttnhan227/Groundwork/actions/runs/37168836149.
- The live Render download page automatically displayed `v1.0.4`, its actual 165,408,455-byte installer, the correct GitHub download URL, and SHA-256 `63d74919b978926268ad1fcc19669d5a23ea0ddacd5c87d22854e70182e226d9`. No second website deployment or per-release link edit was needed.
- Downloaded the complete public installer and independently verified that exact checksum.
- Earlier unpublished tags were diagnostic builds; failed checks prevented publication. The current public release is https://github.com/ttnhan227/Groundwork/releases/tag/v1.0.4.

The existing installer remains unsigned. Release automation does not provide a code-signing identity.
