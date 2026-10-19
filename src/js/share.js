// zwicky. share links: a whole space carried in the URL fragment, …#z=1.<data>.
// <data> is the canonical .zwicky.md, compressed with deflate-raw and encoded
// as base64url; "1." is the version of this encoding. The fragment is never
// sent to a server, so the space stays out of server logs and link previews.
// Pure module: no DOM; CompressionStream and friends exist in browsers and Node.

export const SHARE_PREFIX = '#z=';
export const SHARE_VERSION = '1';
/** Links longer than this may be cut off by mail clients, chat apps or ticket systems. */
export const LONG_LINK = 8000;

/** A link that cannot be read: kind 'damaged' (incomplete or altered) or 'version' (from a newer zwicky). */
export class ShareError extends Error {
  constructor(kind, message) {
    super(message);
    this.kind = kind;
  }
}

async function transform(bytes, stream) {
  const out = new Response(new Blob([bytes]).stream().pipeThrough(stream));
  return new Uint8Array(await out.arrayBuffer());
}

function toBase64Url(bytes) {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(text) {
  if (!/^[A-Za-z0-9_-]+$/.test(text)) throw new Error('not base64url');
  let b64 = text.replace(/-/g, '+').replace(/_/g, '/');
  while (b64.length % 4) b64 += '=';
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** Markdown -> "1.<base64url of deflate-raw>". */
export async function encodeShare(markdown) {
  const bytes = await transform(new TextEncoder().encode(markdown), new CompressionStream('deflate-raw'));
  return `${SHARE_VERSION}.${toBase64Url(bytes)}`;
}

/** "1.<data>" -> Markdown. Throws a ShareError if the payload is from a newer zwicky or damaged. */
export async function decodeShare(payload) {
  const dot = String(payload ?? '').indexOf('.');
  const version = dot > 0 ? payload.slice(0, dot) : '';
  if (!/^\d+$/.test(version)) throw new ShareError('damaged', 'This link is incomplete or damaged.');
  if (version !== SHARE_VERSION) throw new ShareError('version', `This link was made with a newer zwicky (link version ${version}).`);
  try {
    const bytes = await transform(fromBase64Url(payload.slice(dot + 1)), new DecompressionStream('deflate-raw'));
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    // a truncated deflate stream fails here, so a cut-off link never yields half a space
    throw new ShareError('damaged', 'This link is incomplete or damaged.');
  }
}

/** The link to `base` (any URL; its own fragment is dropped) that opens `markdown`. */
export async function shareLink(base, markdown) {
  return String(base).split('#')[0] + SHARE_PREFIX + (await encodeShare(markdown));
}

/** The payload in a location hash ("#z=1.…"), or null if the hash is not a share link. */
export function sharePayload(hash) {
  const h = String(hash ?? '');
  return h.startsWith(SHARE_PREFIX) ? h.slice(SHARE_PREFIX.length) : null;
}
