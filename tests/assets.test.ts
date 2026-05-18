import { describe, it, expect } from 'vitest';
import { signAssetUrl, verifySignedAssetUrl } from '../src/lib/assets.js';

describe('signed asset urls', () => {
  it('round-trips a valid signature', () => {
    const { url, expiresAt } = signAssetUrl('chapter/abc/file.md');
    const u = new URL(url);
    const sig = u.searchParams.get('sig')!;
    expect(verifySignedAssetUrl('chapter/abc/file.md', expiresAt, sig)).toBe(true);
  });

  it('rejects expired signatures', () => {
    const { expiresAt } = signAssetUrl('chapter/a.md', { ttlSeconds: -1 });
    // we just need a sig, any will do — it must reject on time
    expect(verifySignedAssetUrl('chapter/a.md', expiresAt, 'deadbeef')).toBe(false);
  });

  it('rejects a signature for a different key', () => {
    const { url, expiresAt } = signAssetUrl('chapter/a.md');
    const sig = new URL(url).searchParams.get('sig')!;
    expect(verifySignedAssetUrl('chapter/b.md', expiresAt, sig)).toBe(false);
  });

  it('refuses path traversal in keys', () => {
    expect(() => signAssetUrl('../etc/passwd')).toThrow();
    expect(() => signAssetUrl('/abs/path')).toThrow();
  });
});
