# Deployment and Windows release automation

## Activation status (2026-10-06)

Groundwork 1.0.0 is already published. These automation changes do not replace that release or create another version.

The deployment jobs are implemented. Production push deployment stays disabled until credentials are configured and the workflows have been exercised. The existing Render automatic deployment after CI remains enabled.

Required repository configuration:

- Variable `GCP_PROJECT_ID`: `groundwork-505919`.
- Secret `WIF_PROVIDER`: Google Workload Identity Federation provider resource name.
- Secret `WIF_SERVICE_ACCOUNT`: dedicated deployment service-account email.
- Secret `RENDER_DEPLOY_HOOK`: deploy hook for the existing Groundwork-client Render service.
- Variable `PRODUCTION_AUTOMATION_ENABLED`: set to `true` only after the two deployment workflows pass.
- Variable `DESKTOP_API_BASE_URL`: already set to the public Groundwork API URL.

Do not put keys or deploy hooks in commits or chat. No service-account JSON key is needed. Google federation must restrict trust to this repository and its main branch/version-tag workflows. Grant the deploy account Cloud Run deployment access to Groundwork, Artifact Registry writer on `cloud-run-source-deploy`, and Service Account User on the existing runtime account. Preserve existing runtime database, OAuth, and JWT configuration. These permissions need owner approval before creation.

## Push to main

CI tests the local engine, hosted backend, desktop, website, and Windows installer. After all pass, enabled production jobs deploy the backend and website independently. Pull requests and develop do not deploy.

The backend workflow runs hosted tests, builds an image from the requested commit, and refuses a commit older than current main. It deploys a tagged candidate with no production traffic, verifies `/ready` can query the database and reports the exact commit, then directs traffic to that revision and verifies the public URL. Existing environment variables and secrets are preserved. A candidate that fails before promotion does not receive production traffic. A post-promotion failure marks deployment failed; rollback requires selecting a previously working revision.

Schema startup creates missing tables and rejects existing tables missing required columns. It does not apply destructive or general column migrations. Schema-changing releases need an explicit backward-compatible migration and database backup; this gate must not be interpreted as a complete migration system.

The website workflow builds, lints, and runs interaction/release tests, triggers the existing Render deploy hook, then polls `deployment.json` for the exact main commit. It checks the public download page, current installer URL, checksum metadata, and mobile download visibility. Cached older pages cannot satisfy the revision check. The hook is necessary for reliable coordination independently of Render's CI webhook timing.

## Release

Commit and push all changes to main. After production deployment is verified, push the desired new version tag pointing to current main. Do not move or overwrite a published tag. Future versions are the owner's decision; no tag is created by these changes.

The release workflow builds and exercises the actual Windows installer. Then it deploys/verifies the matching hosted backend before publishing the installer. Missing deployment configuration or backend failure blocks publication. After publication, it downloads the public installer/checksum and verifies the bytes, and deploys/verifies the current website. A failed post-publication check needs repair; an already published release is not silently overwritten.

The website reads public GitHub release metadata at runtime. Both a local website preview and the deployed website automatically show the latest uploaded installer when opened/refreshed. No installer URL edits are needed. GitHub caching, rate limits, or outages may temporarily delay metadata; the page exposes errors and links directly to releases.

The installer bundles the desktop UI and local backend. Models are separate downloads/imports. Existing installed applications do not update themselves: users currently install the newer installer. Hosted deployment does not change a local source checkout.

## One-time validation after configuration

1. Run **Deploy server** manually from main; confirm candidate readiness and production revision checks pass.
2. Run **Deploy and verify website** manually; confirm exact deployed commit and public download checks pass.
3. Set `PRODUCTION_AUTOMATION_ENABLED=true`.
4. Push a normal change to main and verify CI dispatches both deployment jobs automatically. No new app release is needed to test deployment automation.

Signing remains optional by the owner's decision. Installer builds use the configured public HTTPS backend address. Production database and OAuth secrets stay in the existing Cloud Run configuration.
