import {
  ViewBookmark,
  ViewBookmarkFile,
  BookmarkView,
  CameraSnapshot,
  BookmarkSliceType,
} from '../types';

/** 存储失败的原因分类 */
export type BookmarkStorageReason =
  | 'quota' // 存储空间不足（localStorage 写满）
  | 'denied' // 浏览器禁止写入（隐私模式 / 站点权限）
  | 'unavailable' // 当前环境没有可用的本地存储
  | 'serialization' // 数据本身无法序列化
  | 'unknown'; // 其它未知错误

export class BookmarkStorageError extends Error {
  reason: BookmarkStorageReason;

  constructor(reason: BookmarkStorageReason, message: string, public cause?: unknown) {
    super(message);
    this.name = 'BookmarkStorageError';
    this.reason = reason;
  }
}

const STORAGE_KEY = 'seismic-view-bookmarks:v1';
const FILE_APP = 'seismic-visualization';
const FILE_KIND = 'seismic-view-bookmarks';
const FILE_VERSION = 1;
const SLICE_TYPES: BookmarkSliceType[] = ['inline', 'crossline', 'depth'];

/** 中文的失败原因说明，用于界面提示与重试 */
export function describeStorageError(error: unknown): string {
  if (error instanceof BookmarkStorageError) {
    return reasonText(error.reason, error.message);
  }
  if (error instanceof DOMException) {
    return reasonText(classifyError(error));
  }
  return '本地存储读写失败，请重试。';
}

function reasonText(reason: BookmarkStorageReason, fallback?: string): string {
  switch (reason) {
    case 'quota':
      return '浏览器本地存储空间已满，书签未能保存。请清理部分本地数据后重试。';
    case 'denied':
      return '浏览器禁止了本地存储写入（常见于隐私模式），书签未能保存。请调整浏览器设置后重试。';
    case 'unavailable':
      return '当前浏览器不支持本地存储，书签无法在本机保留。可使用导出功能备份书签文件。';
    case 'serialization':
      return '书签数据无法被序列化，保存失败。';
    default:
      return fallback || '本地存储读写失败，请重试。';
  }
}

function classifyError(error: unknown): BookmarkStorageReason {
  if (error instanceof DOMException) {
    // 各浏览器对配额 / 拒绝写入的错误码并不统一
    if (
      error.name === 'QuotaExceededError' ||
      error.name === 'NS_ERROR_DOM_QUOTA_REACHED' ||
      error.code === 22 ||
      error.code === 1014
    ) {
      return 'quota';
    }
    if (
      error.name === 'SecurityError' ||
      error.name === 'NS_ERROR_DOM_SECURITY_ERR' ||
      error.code === 18
    ) {
      return 'denied';
    }
  }
  return 'unknown';
}

function getStorage(): Storage {
  try {
    const storage = window.localStorage;
    // 某些浏览器下直接访问也可能抛错，写入一次探针确认可用
    const probeKey = '__seismic_bookmark_probe__';
    storage.setItem(probeKey, '1');
    storage.removeItem(probeKey);
    return storage;
  } catch (error) {
    throw new BookmarkStorageError(
      classifyError(error) === 'unknown' ? 'unavailable' : classifyError(error),
      'localStorage 不可用或被浏览器禁止。',
      error
    );
  }
}

/** 读取全部书签；若数据被外部清空或损坏，返回空列表并说明原因 */
export interface LoadResult {
  bookmarks: ViewBookmark[];
  /** 读取过程中发现的问题（如数据已被清理 / 结构损坏），用于提示用户 */
  warning: string | null;
}

export function loadBookmarks(): LoadResult {
  let storage: Storage;
  try {
    storage = getStorage();
  } catch (error) {
    if (error instanceof BookmarkStorageError) throw error;
    throw new BookmarkStorageError('unavailable', '无法访问本地存储。', error);
  }

  const raw = storage.getItem(STORAGE_KEY);
  if (raw === null) {
    return { bookmarks: [], warning: null };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // 数据损坏，隔离它而不是覆盖，尽量保住用户数据
    return {
      bookmarks: [],
      warning:
        '本地保存的书签数据已损坏、无法读取。可能是浏览器清理或其它工具改写所致；原始内容仍保留在本地存储中。',
    };
  }

  if (!Array.isArray(parsed)) {
    return {
      bookmarks: [],
      warning: '本地书签数据格式不正确，已忽略。书签可能被其它程序改动或清理过。',
    };
  }

  const bookmarks: ViewBookmark[] = [];
  for (const item of parsed) {
    const normalized = normalizeBookmark(item);
    if (normalized) bookmarks.push(normalized);
  }
  return { bookmarks, warning: null };
}

/** 覆盖写入全部书签，并做一次回读校验（发现写入后被清理时能及时指出） */
export function saveBookmarks(bookmarks: ViewBookmark[]): void {
  let serialized: string;
  try {
    serialized = JSON.stringify(bookmarks);
  } catch (error) {
    throw new BookmarkStorageError('serialization', '书签数据无法序列化。', error);
  }

  const storage = getStorage();
  try {
    storage.setItem(STORAGE_KEY, serialized);
  } catch (error) {
    throw new BookmarkStorageError(classifyError(error), describeStorageError(error), error);
  }

  // 回读校验：部分环境（隐私模式、配额边界）写入不报错但实际没落盘
  let written: string | null = null;
  try {
    written = storage.getItem(STORAGE_KEY);
  } catch (error) {
    throw new BookmarkStorageError(
      classifyError(error),
      '书签写入后无法回读，本地存储可能已被禁用或清理，请重试。',
      error
    );
  }
  if (written !== serialized) {
    throw new BookmarkStorageError(
      'unknown',
      '书签写入后校验失败：内容未能真正保留在本地，可能已被浏览器清理，请重试。'
    );
  }
}

/** 生成书签 ID */
export function createBookmarkId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `bm_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

/** 从当前画面状态组装书签视图 */
export function buildBookmarkView(
  camera: CameraSnapshot,
  slices: Record<BookmarkSliceType, { visible: boolean; opacity: number; index: number }>
): BookmarkView {
  return {
    camera: {
      theta: camera.theta,
      phi: camera.phi,
      radius: camera.radius,
      target: [...camera.target] as [number, number, number],
    },
    slices: SLICE_TYPES.reduce(
      (acc, type) => {
        acc[type] = {
          visible: slices[type].visible,
          opacity: slices[type].opacity,
          index: slices[type].index,
        };
        return acc;
      },
      {} as Record<BookmarkSliceType, { visible: boolean; opacity: number; index: number }>
    ),
  };
}

/** 宽松校验并规范化一条书签，不合法返回 null */
export function normalizeBookmark(raw: unknown): ViewBookmark | null {
  if (!raw || typeof raw !== 'object') return null;
  const item = raw as Record<string, unknown>;
  if (
    typeof item.id !== 'string' ||
    typeof item.seismicId !== 'number' ||
    typeof item.name !== 'string' ||
    !item.view ||
    typeof item.view !== 'object'
  ) {
    return null;
  }
  const view = item.view as Record<string, unknown>;
  const camera = view.camera as Record<string, unknown> | undefined;
  const rawSlices = view.slices as Record<string, unknown> | undefined;
  if (
    !camera ||
    typeof camera.theta !== 'number' ||
    typeof camera.phi !== 'number' ||
    typeof camera.radius !== 'number' ||
    !Array.isArray(camera.target) ||
    camera.target.length !== 3 ||
    !rawSlices
  ) {
    return null;
  }
  const slices: BookmarkView['slices'] = {} as BookmarkView['slices'];
  for (const type of SLICE_TYPES) {
    const s = rawSlices[type] as Record<string, unknown> | undefined;
    if (!s || typeof s.visible !== 'boolean' || typeof s.opacity !== 'number') {
      return null;
    }
    slices[type] = {
      visible: s.visible,
      opacity: s.opacity,
      index: typeof s.index === 'number' ? s.index : 0,
    };
  }
  return {
    id: item.id,
    seismicId: item.seismicId,
    name: item.name,
    view: {
      camera: {
        theta: camera.theta,
        phi: camera.phi,
        radius: camera.radius,
        target: [
          Number(camera.target[0]),
          Number(camera.target[1]),
          Number(camera.target[2]),
        ] as [number, number, number],
      },
      slices,
    },
    createdAt: typeof item.createdAt === 'number' ? item.createdAt : Date.now(),
    updatedAt: typeof item.updatedAt === 'number' ? item.updatedAt : Date.now(),
  };
}

/** 全部书签导出为可下载文件结构 */
export function buildExportFile(bookmarks: ViewBookmark[]): ViewBookmarkFile {
  return {
    app: FILE_APP,
    kind: FILE_KIND,
    version: FILE_VERSION,
    exportedAt: Date.now(),
    bookmarks,
  };
}

/** 触发浏览器下载 JSON 备份文件 */
export function downloadBookmarkFile(file: ViewBookmarkFile): void {
  const serialized = JSON.stringify(file, null, 2);
  const blob = new Blob([serialized], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  anchor.href = url;
  anchor.download = `view-bookmarks-${stamp}.json`;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  // 稍后释放，避免部分浏览器下载尚未开始
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export interface ParseImportResult {
  bookmarks: ViewBookmark[];
  /** 被跳过的无效条目数 */
  invalidCount: number;
}

/** 解析并校验导入文件内容 */
export function parseImportFile(text: string): ParseImportResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('文件不是有效的 JSON，请选择书签导出的备份文件。');
  }

  let rawBookmarks: unknown[];
  if (Array.isArray(parsed)) {
    // 兼容直接为书签数组的文件
    rawBookmarks = parsed;
  } else if (parsed && typeof parsed === 'object') {
    const fileObj = parsed as Partial<ViewBookmarkFile>;
    if (fileObj.kind !== FILE_KIND || !Array.isArray(fileObj.bookmarks)) {
      throw new Error('文件格式不符：缺少书签文件标识（kind）或书签列表。');
    }
    rawBookmarks = fileObj.bookmarks;
  } else {
    throw new Error('文件内容无法识别，请选择书签导出的备份文件。');
  }

  const bookmarks: ViewBookmark[] = [];
  let invalidCount = 0;
  for (const raw of rawBookmarks) {
    const normalized = normalizeBookmark(raw);
    if (normalized) {
      bookmarks.push(normalized);
    } else {
      invalidCount += 1;
    }
  }
  return { bookmarks, invalidCount };
}

export const BOOKMARK_STORAGE_KEY = STORAGE_KEY;
