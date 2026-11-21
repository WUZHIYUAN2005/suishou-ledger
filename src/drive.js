const FILES = "https://www.googleapis.com/drive/v3/files";
const UPLOAD = "https://www.googleapis.com/upload/drive/v3/files";
const FOLDER_TYPE = "application/vnd.google-apps.folder";
const FOLDER_FIELDS =
  "id,name,shared,ownedByMe,trashed,mimeType,capabilities(canAddChildren)";
const BACKUP_FIELDS = "id,name,mimeType,parents,ownedByMe,trashed";

const fileUrl = (id) => `${FILES}/${encodeURIComponent(id)}`;
const withQuery = (url, query) => `${url}?${new URLSearchParams(query)}`;
const jsonBody = (method, data) => ({
  method,
  headers: { "Content-Type": "application/json; charset=UTF-8" },
  body: JSON.stringify(data),
});
const isPrivateFolder = (file) =>
  file?.ownedByMe && file.shared === false && file.capabilities?.canAddChildren;

export const DRIVE_ROOT = { id: "root", name: "我的云端硬盘（根目录）" };

export function createDriveClient(token, expiresAt, backupName) {
  const active = new AbortController();
  const close = () => active.abort();
  async function request(url, options) {
    if (active.signal.aborted) throw new Error("Google Drive 连接已变更");
    if (!navigator.onLine) throw new Error("网络未连接，数据保存在本地");
    if (Date.now() >= expiresAt)
      throw new Error("Google 授权已过期，请重新授权");
    const controller = new AbortController();
    const abort = () => controller.abort();
    active.signal.addEventListener("abort", abort, { once: true });
    const timer = setTimeout(abort, 20000);
    try {
      const response = await fetch(url, {
        ...options,
        headers: { Authorization: `Bearer ${token}`, ...options?.headers },
        signal: controller.signal,
      });
      if (response.status === 401)
        throw new Error("Google 授权已过期，请重新授权");
      if (!response.ok) {
        const info = await response.json().catch(() => null);
        const detail = info?.error?.message;
        const error = new Error(
          response.status === 403
            ? `Google Drive 权限不足${detail ? `：${detail}` : ""}`
            : `Google Drive 请求失败（${response.status}）${detail ? `：${detail}` : ""}`,
        );
        error.status = response.status;
        throw error;
      }
      return response.status === 204 ? null : await response.json();
    } catch (error) {
      if (active.signal.aborted) throw new Error("Google Drive 连接已变更");
      if (error.name === "AbortError") throw new Error("请求超时，请检查网络");
      throw error;
    } finally {
      clearTimeout(timer);
      active.signal.removeEventListener("abort", abort);
    }
  }

  async function findBackup() {
    const result = await request(
      withQuery(FILES, {
        q: `name = '${backupName}' and trashed = false`,
        fields: `nextPageToken,files(${BACKUP_FIELDS})`,
        pageSize: "100",
        spaces: "drive",
      }),
    );
    const matches = (result.files ?? []).filter(
      (file) =>
        file.name === backupName && file.mimeType === "application/json",
    );
    if (result.nextPageToken || matches.length > 1) {
      throw new Error(
        "找到多个同名云端账本或列表未完整，请先在 Drive 中检查，避免误覆盖",
      );
    }
    return matches[0] ?? null;
  }

  function getBackup(id) {
    return request(withQuery(fileUrl(id), { fields: BACKUP_FIELDS }));
  }

  function readBackup(id) {
    return request(withQuery(fileUrl(id), { alt: "media" }));
  }

  function writeBackup(id, content) {
    return request(
      withQuery(`${UPLOAD}/${encodeURIComponent(id)}`, {
        uploadType: "media",
        fields: "id",
      }),
      jsonBody("PATCH", content),
    );
  }

  async function createBackup(content, folderId) {
    const boundary = "ledgerSync" + Math.random().toString(36).slice(2);
    const metadata = {
      name: backupName,
      mimeType: "application/json",
      description: "随手账本私人账目同步文件，请勿手动修改",
      ...(folderId !== DRIVE_ROOT.id ? { parents: [folderId] } : {}),
    };
    const jsonPart =
      "\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n";
    const result = await request(
      withQuery(UPLOAD, {
        uploadType: "multipart",
        fields: BACKUP_FIELDS,
      }),
      {
        method: "POST",
        headers: { "Content-Type": `multipart/related; boundary=${boundary}` },
        body: `--${boundary}${jsonPart}${JSON.stringify(metadata)}\r\n--${boundary}${jsonPart}${JSON.stringify(content)}\r\n--${boundary}--`,
      },
    );
    if (!result?.id) throw new Error("Google Drive 没有返回备份文件 ID");
    return result;
  }

  async function folder(id) {
    const file = await request(
      withQuery(fileUrl(id), { fields: FOLDER_FIELDS }),
    );
    if (!file?.id || file.mimeType !== FOLDER_TYPE || file.trashed) {
      throw new Error("该文件夹已不存在");
    }
    return file;
  }

  async function destination(id) {
    if (id === DRIVE_ROOT.id)
      return { ...DRIVE_ROOT, actualId: (await folder(id)).id };
    const file = await folder(id);
    if (!isPrivateFolder(file)) {
      throw new Error("请选择自己拥有、未共享且可写入的文件夹");
    }
    return { id: file.id, actualId: file.id, name: file.name };
  }

  async function listFolders() {
    const folders = [];
    let pageToken;
    do {
      const page = await request(
        withQuery(FILES, {
          q: `mimeType = '${FOLDER_TYPE}' and trashed = false and 'me' in owners`,
          fields: `nextPageToken,files(${FOLDER_FIELDS})`,
          orderBy: "name_natural",
          pageSize: "100",
          spaces: "drive",
          ...(pageToken ? { pageToken } : {}),
        }),
      );
      folders.push(...(page.files ?? []).filter(isPrivateFolder));
      pageToken = page.nextPageToken;
    } while (pageToken);
    return folders.map(({ id, name }) => ({ id, name }));
  }

  async function createFolder(rawName) {
    const name = rawName.trim();
    if (!name || name.length > 80)
      throw new Error("请输入 1 到 80 个字符的文件夹名称");
    const file = await request(
      withQuery(FILES, { fields: FOLDER_FIELDS }),
      jsonBody("POST", {
        name,
        mimeType: FOLDER_TYPE,
      }),
    );
    if (!file?.id) throw new Error("Google Drive 没有返回文件夹 ID");
    return { id: file.id, name: file.name };
  }

  async function moveBackup(id, target) {
    const backup = await getBackup(id);
    if (
      !backup.ownedByMe ||
      backup.trashed ||
      backup.name !== backupName ||
      backup.mimeType !== "application/json"
    ) {
      throw new Error("只能移动你拥有的随手账本备份文件");
    }
    const parents = backup.parents ?? [];
    if (parents.includes(target.actualId)) return backup;
    const moved = await request(
      withQuery(fileUrl(id), {
        addParents: target.actualId,
        ...(parents.length ? { removeParents: parents.join(",") } : {}),
        fields: BACKUP_FIELDS,
      }),
      jsonBody("PATCH", {}),
    );
    if (moved?.id !== id || !moved.parents?.includes(target.actualId)) {
      throw new Error("未能确认备份文件的新位置，请在 Google Drive 中查看");
    }
    return moved;
  }

  return {
    close,
    expiresAt,
    findBackup,
    getBackup,
    readBackup,
    writeBackup,
    createBackup,
    folder,
    destination,
    listFolders,
    createFolder,
    moveBackup,
  };
}
