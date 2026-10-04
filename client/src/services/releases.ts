export const releaseRepository = "ttnhan227/Groundwork";
export const releasesUrl = `https://github.com/${releaseRepository}/releases`;

export interface WindowsRelease {
  version: string;
  url: string;
  bytes: number;
  checksum: string | null;
  preview: boolean;
}

export function parseWindowsRelease(value: unknown): WindowsRelease | null {
  if (!value || typeof value !== "object") return null;
  const release = value as Record<string, unknown>;
  if (release.draft !== false || typeof release.prerelease !== "boolean" || typeof release.tag_name !== "string" || !/^v\d+\.\d+\.\d+$/.test(release.tag_name) || !Array.isArray(release.assets)) return null;
  const asset = release.assets.find((item: Record<string, unknown>) => item?.name === "Groundwork-windows-x64-setup.exe" && item.state === "uploaded");
  if (!asset || typeof asset.browser_download_url !== "string" || typeof asset.size !== "number" || asset.size <= 0) return null;
  let url: URL;
  try { url = new URL(asset.browser_download_url); } catch { return null; }
  if (url.origin !== "https://github.com" || !url.pathname.startsWith(`/${releaseRepository}/releases/download/`)) return null;
  const checksum = typeof asset.digest === "string" && /^sha256:[a-f0-9]{64}$/i.test(asset.digest) ? asset.digest.slice(7) : null;
  return { version: release.tag_name, url: url.href, bytes: asset.size, checksum, preview: release.prerelease || release.tag_name.startsWith('v0.') };
}

export async function fetchWindowsRelease(signal: AbortSignal): Promise<WindowsRelease | null> {
  const response = await fetch(`https://api.github.com/repos/${releaseRepository}/releases?per_page=100`, {
    signal,
    cache: "no-store",
    headers: { Accept: "application/vnd.github+json" },
  });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error("Release service is unavailable");
  const data: unknown = await response.json();
  if (!Array.isArray(data)) throw new Error("Release service returned an invalid response");
  const releases = data.map(parseWindowsRelease).filter((item): item is WindowsRelease => item !== null);
  releases.sort((a, b) => {
    const left = a.version.slice(1).split('.').map(Number);
    const right = b.version.slice(1).split('.').map(Number);
    for (let i = 0; i < 3; i++) if (left[i] !== right[i]) return right[i] - left[i];
    return 0;
  });
  return releases[0] || null;
}
