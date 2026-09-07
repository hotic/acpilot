import { describe, expect, it } from 'vitest';
import { isSafeExternalUrl } from '../src/shared/protocol';

// The host hands accepted URLs to vscode.env.openExternal, so the scheme whitelist is the whole security boundary
describe('isSafeExternalUrl', () => {
  it('accepts https / http / mailto', () => {
    expect(isSafeExternalUrl('https://example.com/x?y=1')).toBe(true);
    expect(isSafeExternalUrl('http://example.com')).toBe(true);
    expect(isSafeExternalUrl('mailto:a@b.com')).toBe(true);
  });

  it('rejects dangerous or local schemes', () => {
    expect(isSafeExternalUrl('javascript:alert(1)')).toBe(false);
    expect(isSafeExternalUrl('file:///etc/passwd')).toBe(false);
    expect(isSafeExternalUrl('vscode://evillens/command')).toBe(false);
    expect(isSafeExternalUrl('data:text/html,<script>1</script>')).toBe(false);
  });

  it('rejects non-URLs', () => {
    expect(isSafeExternalUrl('')).toBe(false);
    expect(isSafeExternalUrl('not a url')).toBe(false);
    expect(isSafeExternalUrl('/relative/path')).toBe(false);
  });
});
