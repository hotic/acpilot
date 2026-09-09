import { describe, expect, it } from 'vitest';
import { promptIsStuck, scrollerUsable } from '../src/webview/chat/promptStuck';

const entry = (p: { intersecting: boolean; top: number; rootTop: number; rootHeight: number; rootWidth?: number; root?: null }) => ({
  isIntersecting: p.intersecting,
  boundingClientRect: { top: p.top },
  rootBounds: p.root === null ? null : { top: p.rootTop, height: p.rootHeight, width: p.rootWidth ?? 320 },
});

describe('promptIsStuck', () => {
  it('ignores a collapsed thread so a hidden sidebar does not fold visible prompts', () => {
    expect(promptIsStuck(entry({ intersecting: false, top: -80, rootTop: 0, rootHeight: 0 }))).toBeUndefined();
    expect(promptIsStuck(entry({ intersecting: false, top: 0, rootTop: 0, rootHeight: 400, rootWidth: 0 }))).toBeUndefined();
    expect(promptIsStuck(entry({ intersecting: false, top: -80, rootTop: 0, rootHeight: 0, root: null }))).toBeUndefined();
  });

  it('is stuck when the exchange top has scrolled above the thread', () => {
    expect(promptIsStuck(entry({ intersecting: false, top: -8, rootTop: 0, rootHeight: 400 }))).toBe(true);
  });

  it('is not stuck while the exchange top is in view, or still below it', () => {
    expect(promptIsStuck(entry({ intersecting: true, top: 12, rootTop: 0, rootHeight: 400 }))).toBe(false);
    expect(promptIsStuck(entry({ intersecting: false, top: 480, rootTop: 0, rootHeight: 400 }))).toBe(false);
  });
});

describe('scrollerUsable', () => {
  it('rejects a collapsed box and accepts a real thread', () => {
    expect(scrollerUsable({ clientHeight: 0, clientWidth: 320 })).toBe(false);
    expect(scrollerUsable({ clientHeight: 400, clientWidth: 0 })).toBe(false);
    expect(scrollerUsable({ clientHeight: 400, clientWidth: 320 })).toBe(true);
  });
});
