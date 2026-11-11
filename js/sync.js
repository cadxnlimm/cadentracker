// Keeps one encrypted file in your Google Drive's hidden app folder ("appDataFolder").
// That folder is private to this app: it doesn't show in your Drive, and the app can't see your other files.
// The file is encrypted with your passphrase before upload, so Google stores only unreadable data.
import * as google from './google.js';

const NAME = 'cadentracker-vault.json';
const FILES = 'https://www.googleapis.com/drive/v3/files';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3/files';

let fileId = null;

export const isConnected = () => google.has('drive');
export function reset() { fileId = null; }

async function findFile() {
  if (fileId) return fileId;
  const q = new URLSearchParams({ spaces: 'appDataFolder', q: `name = '${NAME}' and trashed = false`, fields: 'files(id, modifiedTime)', orderBy: 'modifiedTime desc', pageSize: '5' });
  const data = await (await google.authFetch(`${FILES}?${q}`, {}, 'Google Drive')).json();
  fileId = data.files?.[0]?.id || null;
  return fileId;
}

// The synced (still encrypted) blob, or null if nothing has been synced from this Google account yet.
export async function download() {
  const id = await findFile();
  if (!id) return null;
  const res = await google.authFetch(`${FILES}/${encodeURIComponent(id)}?alt=media`, {}, 'Google Drive');
  return res.json();
}

export async function upload(blob) {
  const body = JSON.stringify(blob);
  const id = await findFile();
  if (id) {
    await google.authFetch(`${UPLOAD}/${encodeURIComponent(id)}?uploadType=media`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body,
    }, 'Google Drive');
    return;
  }
  const boundary = `ct${crypto.randomUUID()}`;
  const multipart = [
    `--${boundary}`, 'Content-Type: application/json; charset=UTF-8', '',
    JSON.stringify({ name: NAME, parents: ['appDataFolder'], mimeType: 'application/json' }),
    `--${boundary}`, 'Content-Type: application/json', '', body, `--${boundary}--`, '',
  ].join('\r\n');
  const res = await google.authFetch(`${UPLOAD}?uploadType=multipart&fields=id`, {
    method: 'POST', headers: { 'Content-Type': `multipart/related; boundary=${boundary}` }, body: multipart,
  }, 'Google Drive');
  fileId = (await res.json()).id;
}

// Removes the synced copy from Drive (this device keeps its own).
export async function remove() {
  const id = await findFile();
  if (id) await google.authFetch(`${FILES}/${encodeURIComponent(id)}`, { method: 'DELETE' }, 'Google Drive');
  fileId = null;
}
