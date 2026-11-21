const DB_NAME = "suishou-ledger.card-covers.v1";
const STORE = "covers";
let opening;

function openDatabase() {
  opening ??= new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      request.result.onversionchange = () => {
        request.result.close();
        opening = null;
      };
      resolve(request.result);
    };
  }).catch((error) => {
    opening = null;
    throw error;
  });
  return opening;
}

async function useStore(mode, operation) {
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE, mode);
    const request = operation(transaction.objectStore(STORE));
    transaction.oncomplete = () => resolve(request.result);
    transaction.onabort = () => reject(transaction.error ?? request.error);
  });
}

export async function readCovers() {
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE, "readonly");
    const request = transaction.objectStore(STORE).openCursor();
    const covers = new Map();
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) return;
      covers.set(cursor.key, cursor.value);
      cursor.continue();
    };
    transaction.oncomplete = () => resolve(covers);
    transaction.onabort = () => reject(transaction.error ?? request.error);
  });
}

export const putCover = (id, blob) =>
  useStore("readwrite", (store) => store.put(blob, id));
export const removeCover = (id) =>
  useStore("readwrite", (store) => store.delete(id));

export async function readCoverImage(file) {
  if (!file || file.size > 15 * 1024 * 1024)
    throw new Error("请选择 15 MB 以内的 JPG、PNG 或 WebP 图片。");
  const head = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  const isJpeg = head[0] === 255 && head[1] === 216 && head[2] === 255;
  const isPng = [137, 80, 78, 71, 13, 10, 26, 10].every(
    (byte, index) => head[index] === byte,
  );
  const isWebp =
    String.fromCharCode(...head.slice(0, 4)) === "RIFF" &&
    String.fromCharCode(...head.slice(8, 12)) === "WEBP";
  if (!isJpeg && !isPng && !isWebp)
    throw new Error("请选择有效的 JPG、PNG 或 WebP 图片。");
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    return image;
  } catch (_) {
    throw new Error("无法读取这张图片，请更换文件。");
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function paintCover(canvas, image, { fit, zoom, x, y }) {
  const { width, height } = canvas;
  const context = canvas.getContext("2d");
  context.fillStyle = "#1a2540";
  context.fillRect(0, 0, width, height);
  const widthRatio = width / image.naturalWidth;
  const heightRatio = height / image.naturalHeight;
  const scale =
    fit === "contain"
      ? Math.min(widthRatio, heightRatio)
      : Math.max(widthRatio, heightRatio) * zoom;
  const scaledWidth = image.naturalWidth * scale;
  const scaledHeight = image.naturalHeight * scale;
  const left =
    (width - scaledWidth) / 2 + (Math.max(0, scaledWidth - width) * x) / 2;
  const top =
    (height - scaledHeight) / 2 + (Math.max(0, scaledHeight - height) * y) / 2;
  context.drawImage(image, left, top, scaledWidth, scaledHeight);
}

export function coverBlob(canvas) {
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (blob) =>
        blob ? resolve(blob) : reject(new Error("无法生成封面图片。")),
      "image/jpeg",
      0.9,
    ),
  );
}
