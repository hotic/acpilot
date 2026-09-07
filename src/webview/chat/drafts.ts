import type { Draft } from '@shared/transcript';
import { MAX_IMAGE_BYTES, MAX_TEXT_BYTES, imageMimeOf } from '@shared/attachments';
import { t } from '../i18n';

export interface Collected {
  drafts: Draft[];
  // Why something was left out, one line each, for a toast
  refused: string[];
}

// Whether a drag carries anything the composer can take: a uri-list (VS Code Explorer) or real files (Finder / clipboard)
export function hasPayload(dt: DataTransfer | null): boolean {
  if (!dt) return false;
  return [...dt.types].some(t => t === 'Files' || t === 'text/uri-list');
}

// Everything a paste or drop can carry, turned into drafts. Explorer drags arrive as a uri-list of real paths and take precedence: those are handed to the host as
// file drafts (it reads images itself). OS files only exist as blobs here (no path in a webview): accepted images go inline, small text files are embedded, the rest is refused
export async function collectDrafts(dt: DataTransfer, cwd: string): Promise<Collected> {
  const out: Collected = { drafts: [], refused: [] };
  const uris = dt.getData('text/uri-list').split(/\r?\n/).map(l => l.trim()).filter(l => l && !l.startsWith('#') && /^file:/i.test(l));
  if (uris.length) {
    for (const uri of uris) out.drafts.push({ kind: 'file', uri, name: nameOf(uri, cwd) });
    return out;
  }
  for (const f of Array.from(dt.files)) {
    const mimeType = imageMimeOf(f.name) ?? (f.type.startsWith('image/') && imageMimeOf(`.${f.type.slice(6)}`));
    if (mimeType) {
      if (f.size > MAX_IMAGE_BYTES) { out.refused.push(t('attach.tooBigImage', { name: f.name, mb: MAX_IMAGE_BYTES >> 20 })); continue; }
      out.drafts.push({ kind: 'image', mimeType, data: await base64Of(f), name: f.name === 'image.png' ? undefined : f.name });
      continue;
    }
    if (f.size > MAX_TEXT_BYTES) { out.refused.push(t('attach.tooBigText', { name: f.name, kb: MAX_TEXT_BYTES >> 10 })); continue; }
    const text = await f.text();
    if (text.includes('\0')) { out.refused.push(t('attach.binary', { name: f.name })); continue; }
    out.drafts.push({ kind: 'text', name: f.name, text });
  }
  return out;
}

// Path relative to the workspace when inside it, otherwise the file name
export function nameOf(uri: string, cwd: string): string {
  let path: string;
  try { path = decodeURIComponent(new URL(uri).pathname); } catch { return uri; }
  const root = cwd.endsWith('/') ? cwd : `${cwd}/`;
  return path.startsWith(root) ? path.slice(root.length) : path.split('/').pop() || path;
}

function base64Of(f: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve((r.result as string).split(',', 2)[1] ?? '');
    r.onerror = () => reject(r.error);
    r.readAsDataURL(f);
  });
}
