import assert from 'node:assert/strict';
import test from 'node:test';
import { extractReleaseNotes } from './extract-release-notes.mjs';

test('extracts specific version section from changelog markdown', () => {
  const sample = `
# Changelog

---

## [1.1.0] - 2026-10-25

### Hardware Diagnostics & AI
- Added dynamic CPU and RAM detection.
- Power-user settings hub.

---

## [1.0.0] - 2026-10-23

### Initial Release
- File search and indexing.
`;

  const notes110 = extractReleaseNotes(sample, 'v1.1.0');
  assert.match(notes110, /Hardware Diagnostics & AI/);
  assert.match(notes110, /dynamic CPU and RAM detection/);
  assert.ok(!notes110.includes('Initial Release'));

  const notes100 = extractReleaseNotes(sample, '1.0.0');
  assert.match(notes100, /Initial Release/);
  assert.ok(!notes100.includes('Hardware Diagnostics'));
});

test('falls back gracefully if version is not present', () => {
  const sample = `# Changelog\n\n## [1.0.0] - 2026-10-23\n\nInitial notes.`;
  const fallback = extractReleaseNotes(sample, 'v9.9.9');
  assert.match(fallback, /Groundwork v9\.9\.9 release/);
  assert.match(fallback, /self-contained setup installer/);
});
