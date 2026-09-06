// Attachment helpers shared by host and webview: which files count as images, and the size ceilings both sides enforce

// Inline image payloads above this are refused (the webview refuses the paste, the host falls back to a resource_link for dropped files)
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
// Text dropped from outside the workspace is embedded into the prompt, so it stays small
export const MAX_TEXT_BYTES = 256 * 1024;

const IMAGE_MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
};

// MIME type for an image file name, undefined for anything that isn't an image the models accept
export function imageMimeOf(name: string): string | undefined {
  const m = /\.[^./\\]+$/.exec(name);
  return m ? IMAGE_MIME[m[0].toLowerCase()] : undefined;
}

// File extension to persist a blob of the given MIME type under
export function extOfMime(mimeType: string): string {
  return Object.entries(IMAGE_MIME).find(([, m]) => m === mimeType)?.[0] ?? '.bin';
}

// Base64 payload size in bytes (without decoding)
export function base64Bytes(data: string): number {
  const pad = data.endsWith('==') ? 2 : data.endsWith('=') ? 1 : 0;
  return Math.floor((data.length * 3) / 4) - pad;
}
