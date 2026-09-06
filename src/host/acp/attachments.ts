import { readFile, stat } from 'node:fs/promises';
import { basename } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type * as acp from '@agentclientprotocol/sdk';
import type { Attachment, Draft } from '@shared/transcript';
import { MAX_IMAGE_BYTES, base64Bytes, extOfMime, imageMimeOf } from '@shared/attachments';

// Where a session parks attachment payloads (TranscriptStore implements it): the name is what the turn keeps and the webview loads via blobBase,
// the absolute path is what the agent gets told when the content is embedded
export interface BlobStore {
  saveBlob(sessionId: string, ext: string, bytes: Uint8Array): Promise<{ name: string; path: string }>;
}

export interface PreparedPrompt {
  blocks: acp.ContentBlock[];
  attachments: Attachment[];
  // What could not be done as asked (a draft dropped for size, a blob that failed to write); the prompt itself still goes out
  problems: string[];
}

// Turns the composer's text + drafts into the wire prompt and the transcript attachments. Text goes first, then one block per draft:
// images inline as base64 (never gated on promptCapabilities.image — Grok advertises false yet accepts them), dropped text as an embedded resource
// whose uri is the blob written to disk, files as resource_link so the agent reads them itself — except image files, which are read here and sent as pixels.
// Never throws for a single draft: a payload the disk refuses still goes over the wire (the preview is lost), an oversized image is dropped with a note
export async function preparePrompt(sessionId: string, text: string, drafts: Draft[], blobs: BlobStore): Promise<PreparedPrompt> {
  const out: PreparedPrompt = { blocks: text ? [{ type: 'text', text }] : [], attachments: [], problems: [] };
  const stage = async (ext: string, bytes: Uint8Array, label: string) => {
    try { return await blobs.saveBlob(sessionId, ext, bytes); }
    catch (e) { out.problems.push(`${label} 没能存盘（${e instanceof Error ? e.message : String(e)}），本轮照常发出，历史里不会有预览`); return undefined; }
  };
  for (const d of drafts) {
    if (d.kind === 'image') {
      if (base64Bytes(d.data) > MAX_IMAGE_BYTES) { out.problems.push(`${d.name ?? '图片'} 超过 ${MAX_IMAGE_BYTES >> 20} MB，已跳过`); continue; }
      const saved = await stage(extOfMime(d.mimeType), Buffer.from(d.data, 'base64'), d.name ?? '图片');
      out.blocks.push({ type: 'image', mimeType: d.mimeType, data: d.data });
      out.attachments.push({ kind: 'image', blob: saved?.name, mimeType: d.mimeType, name: d.name });
    } else if (d.kind === 'text') {
      // The embedded resource is addressed by the blob on disk, so an agent that insists on reading a real file finds one
      const saved = await stage('.txt', Buffer.from(d.text, 'utf8'), d.name);
      const uri = saved ? pathToFileURL(saved.path).href : `attachment:///${encodeURIComponent(d.name)}`;
      out.blocks.push({ type: 'resource', resource: { uri, mimeType: 'text/plain', text: d.text } });
      out.attachments.push({ kind: 'text', blob: saved?.name, name: d.name });
    } else {
      const image = await readImageFile(d.uri);
      if (image) {
        const saved = await stage(extOfMime(image.mimeType), image.bytes, d.name);
        out.blocks.push({ type: 'image', mimeType: image.mimeType, data: image.bytes.toString('base64') });
        out.attachments.push({ kind: 'image', blob: saved?.name, mimeType: image.mimeType, name: d.name });
      } else {
        out.blocks.push({ type: 'resource_link', uri: d.uri, name: d.name || basename(d.uri) });
        out.attachments.push({ kind: 'file', uri: d.uri, name: d.name });
      }
    }
  }
  return out;
}

// A file:// URI that names an image the models accept, small enough to inline; anything else (non-image, unreadable, oversized, remote) yields undefined.
// Size is checked before reading so an oversized file never lands in memory
async function readImageFile(uri: string): Promise<{ mimeType: string; bytes: Buffer } | undefined> {
  const mimeType = imageMimeOf(uri);
  if (!mimeType || !uri.startsWith('file:')) return undefined;
  try {
    const path = fileURLToPath(uri);
    const { size } = await stat(path);
    return size <= MAX_IMAGE_BYTES ? { mimeType, bytes: await readFile(path) } : undefined;
  } catch {
    return undefined;
  }
}

// One-line description of what a prompt carried, for the title of a session opened with attachments only and for the queue note
export function describeDrafts(drafts: Draft[]): string {
  const images = drafts.filter(d => d.kind === 'image').length;
  const files = drafts.filter(d => d.kind !== 'image').map(d => d.name);
  return [images ? `${images} 张图片` : '', ...files].filter(Boolean).join('、');
}
