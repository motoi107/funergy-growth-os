// Google Drive v3 access for the intake worker. The worker only lists the
// configured 00_Upload folders, reads files it has recorded, and renames/moves
// files inside the configured store folders. It never deletes or trashes.

const API = 'https://www.googleapis.com/drive/v3';
const FOLDER_MIME = 'application/vnd.google-apps.folder';
const FILE_FIELDS = 'id,name,mimeType,size,md5Checksum,createdTime,modifiedTime,parents,trashed,owners(emailAddress),lastModifyingUser(emailAddress)';

export async function googleAccessToken({ fetch, clientId, clientSecret, refreshToken }) {
  if (!clientId || !clientSecret || !refreshToken) return { ok: false, error: 'drive_not_configured' };
  try {
    const r = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, refresh_token: refreshToken, grant_type: 'refresh_token' }).toString(),
    });
    if (!r.ok) return { ok: false, error: 'drive_auth_' + r.status };
    const j = await r.json();
    return j.access_token ? { ok: true, token: j.access_token } : { ok: false, error: 'drive_auth_no_token' };
  } catch { return { ok: false, error: 'drive_auth_network' }; }
}

const q = s => String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'");

export function createDrive({ fetch, getToken }) {
  let token = null;
  const driveOf = new Map();   // folder id -> shared drive id (null in My Drive)
  async function call(path, init = {}, raw = false) {
    for (let attempt = 0; attempt < 2; attempt++) {
      if (!token) { const t = await getToken(); if (!t.ok) { const e = new Error(t.error); e.code = t.error; throw e; } token = t.token; }
      const r = await fetch(API + path, { ...init, headers: { ...(init.headers || {}), authorization: 'Bearer ' + token } });
      if (r.status === 401 && attempt === 0) { token = null; continue; }
      if (raw) return r;
      let body = null; try { body = await r.json(); } catch { body = null; }
      return { status: r.status, body };
    }
  }
  const common = 'supportsAllDrives=true&includeItemsFromAllDrives=true';
  // Items inside a shared drive are listed with corpora=drive and that drive's id; the default
  // corpus ('user') is not relied on for folders that live in a shared drive.
  async function scope(folderId) {
    if (!driveOf.has(folderId)) {
      const r = await call(`/files/${encodeURIComponent(folderId)}?fields=id,driveId&supportsAllDrives=true`);
      if (r.status !== 200) return '';
      driveOf.set(folderId, (r.body && r.body.driveId) || null);
    }
    const id = driveOf.get(folderId);
    return id ? '&corpora=drive&driveId=' + encodeURIComponent(id) : '';
  }
  return {
    async listFolder(folderId, pageToken) {
      const p = new URLSearchParams({ q: `'${q(folderId)}' in parents and trashed=false and mimeType!='${FOLDER_MIME}'`,
        fields: `nextPageToken,files(${FILE_FIELDS})`, pageSize: '100', orderBy: 'createdTime' });
      if (pageToken) p.set('pageToken', pageToken);
      const r = await call('/files?' + p + '&' + common + await scope(folderId));
      if (r.status !== 200) { const e = new Error('drive_list_' + r.status); e.status = r.status; throw e; }
      return { files: r.body.files || [], next: r.body.nextPageToken || null };
    },
    async get(fileId) {
      const r = await call(`/files/${encodeURIComponent(fileId)}?fields=${encodeURIComponent(FILE_FIELDS)}&supportsAllDrives=true`);
      return { status: r.status, file: r.status === 200 ? r.body : null };
    },
    async download(fileId) {
      const r = await call(`/files/${encodeURIComponent(fileId)}?alt=media&supportsAllDrives=true`, {}, true);
      if (r.status !== 200) { const e = new Error('drive_download_' + r.status); e.status = r.status; throw e; }
      return new Uint8Array(await r.arrayBuffer());
    },
    async update(fileId, { name, addParents, removeParents }) {
      const p = new URLSearchParams({ fields: FILE_FIELDS, supportsAllDrives: 'true' });
      if (addParents) p.set('addParents', addParents);
      if (removeParents) p.set('removeParents', removeParents);
      const r = await call(`/files/${encodeURIComponent(fileId)}?${p}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(name ? { name } : {}) });
      if (r.status !== 200) { const e = new Error('drive_update_' + r.status); e.status = r.status; throw e; }
      return r.body;
    },
    async findFolders(parentId, name) {
      const p = new URLSearchParams({ q: `'${q(parentId)}' in parents and name='${q(name)}' and mimeType='${FOLDER_MIME}' and trashed=false`, fields: 'files(id,name)' });
      const r = await call('/files?' + p + '&' + common + await scope(parentId));
      if (r.status !== 200) { const e = new Error('drive_list_' + r.status); e.status = r.status; throw e; }
      return r.body.files || [];
    },
    async createFolder(parentId, name) {
      const r = await call('/files?supportsAllDrives=true&fields=id,name', { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name, mimeType: FOLDER_MIME, parents: [parentId] }) });
      if (r.status !== 200) { const e = new Error('drive_create_' + r.status); e.status = r.status; throw e; }
      return r.body;
    },
    async listNames(folderId) {
      const names = []; let pageToken = null;
      do {
        const p = new URLSearchParams({ q: `'${q(folderId)}' in parents and trashed=false`, fields: 'nextPageToken,files(id,name)', pageSize: '1000' });
        if (pageToken) p.set('pageToken', pageToken);
        const r = await call('/files?' + p + '&' + common + await scope(folderId));
        if (r.status !== 200) { const e = new Error('drive_list_' + r.status); e.status = r.status; throw e; }
        (r.body.files || []).forEach(f => names.push({ id: f.id, name: f.name }));
        pageToken = r.body.nextPageToken || null;
      } while (pageToken);
      return names;
    },
  };
}

export const viewUrl = id => 'https://drive.google.com/file/d/' + encodeURIComponent(id) + '/view';
export const folderUrl = id => 'https://drive.google.com/drive/folders/' + encodeURIComponent(id);
