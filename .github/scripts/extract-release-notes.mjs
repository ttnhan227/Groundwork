import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export function extractReleaseNotes(changelogText, tag) {
  const cleanTag = tag.replace(/^v/, '');
  const lines = changelogText.split(/\r?\n/);
  let capturing = false;
  const captured = [];

  for (const line of lines) {
    if (line.startsWith('## [')) {
      if (capturing) break;
      if (line.includes(`[${cleanTag}]`) || line.includes(`[v${cleanTag}]`)) {
        capturing = true;
        continue;
      }
    }
    if (capturing) {
      if (line.trim() === '---' && captured.length > 0) break;
      captured.push(line);
    }
  }

  const result = captured.join('\n').trim();
  if (result) {
    return result;
  }

  return `Groundwork ${tag} release for Windows 10 and Windows 11 (64-bit).\n\nIncludes the self-contained setup installer and portable archive. No external runtimes or databases are required.`;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const root = process.cwd();
  const changelogPath = path.join(root, 'CHANGELOG.md');
  const tag = process.argv[2] || process.env.RELEASE_TAG || '';
  const outputPath = process.argv[3] || path.join(root, 'release-assets', 'release-notes.md');

  if (!tag) {
    console.error('Usage: node extract-release-notes.mjs <tag> [outputPath]');
    process.exit(1);
  }

  let changelogText = '';
  if (fs.existsSync(changelogPath)) {
    changelogText = fs.readFileSync(changelogPath, 'utf8');
  }

  const notes = extractReleaseNotes(changelogText, tag);

  const outDir = path.dirname(outputPath);
  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
  }

  fs.writeFileSync(outputPath, notes + '\n', 'utf8');
  console.log(`Extracted release notes for ${tag} to ${outputPath}`);
}
