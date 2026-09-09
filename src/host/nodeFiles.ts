import { readdir } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { FileHit } from '@shared/protocol';
import { rankFiles } from './fileRank';

// How long one listing is reused before the next search lists again
const TTL = 15_000;
const MAX_FILES = 20_000;
const EXCLUDE = new Set(['node_modules', '.git']);

// The @ mention index for a host without an IDE file index (the sidecar when the shell does not offer searchFiles): a plain
// directory walk of the workspace folder, capped and cached like WorkspaceFiles, ranked with the same scorer
export class NodeFiles {
  private cache?: { root: string; at: number; files: FileHit[] };
  private listing?: Promise<FileHit[]>;

  constructor(private root: () => string) {}

  async search(query: string, limit = 20): Promise<FileHit[]> {
    return rankFiles(await this.list(), query, limit);
  }

  private list(): Promise<FileHit[]> {
    const root = this.root();
    if (this.cache && this.cache.root === root && Date.now() - this.cache.at < TTL) return Promise.resolve(this.cache.files);
    // Concurrent searches while a listing is in flight share it
    this.listing ??= this.walk(root).finally(() => { this.listing = undefined; });
    return this.listing;
  }

  private async walk(root: string): Promise<FileHit[]> {
    const files: FileHit[] = [];
    // Breadth-first so a shallow file always makes the cap before a deep one
    const queue = [root];
    while (queue.length && files.length < MAX_FILES) {
      const dir = queue.shift()!;
      let entries;
      try { entries = await readdir(dir, { withFileTypes: true }); } catch { continue; }
      for (const e of entries) {
        if (files.length >= MAX_FILES) break;
        const abs = join(dir, e.name);
        if (e.isDirectory()) { if (!EXCLUDE.has(e.name)) queue.push(abs); }
        else if (e.isFile()) files.push({ uri: pathToFileURL(abs).href, path: relative(root, abs).split('\\').join('/') });
      }
    }
    files.sort((a, b) => depth(a.path) - depth(b.path) || a.path.localeCompare(b.path));
    this.cache = { root, at: Date.now(), files };
    return files;
  }
}

function depth(path: string): number {
  return path.split('/').length;
}
