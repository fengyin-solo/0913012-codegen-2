import {
  ViewBookmark,
  BookmarkExportFile,
  BookmarkStorageError,
  SliceTypeName,
} from '../types';

/**
 * 视图书签本地存储服务。
 *
 * localStorage 中按地震数据体分组保存：
 *   key: seismic-view-bookmarks:v1:<seismicId>
 *   value: { bookmarks: ViewBookmark[] }
 *
 * 所有对外方法在失败时抛出 BookmarkStorageError，调用方据此提示原因并重试。
 */

const KEY_PREFIX = 'seismic-view-bookmarks:v1:';
const APP_NAME = 'seismic-visualization';
const EXPORT_VERSION = 1;

const SLICE_TYPES: SliceTypeName[] = ['inline', 'crossline', 'depth'];

const err = (
  type: BookmarkStorageError['type'],
  message: string
): BookmarkStorageError => ({ type, message });

/** 检测 localStorage 是否可用（隐私模式 / 被浏览器策略禁用时会不可用）。 */
export function isStorageAvailable(): boolean {
  try {
    const probe = '__bookmark_probe__';
    window.localStorage.setItem(probe, '1');
    window.localStorage.removeItem(probe);
    return true;
  } catch {
    return false;
  }
}

function keyFor(seismicId: number): string {
  return `${KEY_PREFIX}${seismicId}`;
}

function isQuotaError(e: unknown): boolean {
  if (!e || typeof e !== 'object') return false;
  const name = (e as { name?: unknown }).name;
  const code = (e as { code?: unknown }).code;
  return (
    name === 'QuotaExceededError' ||
    name === 'NS_ERROR_DOM_QUOTA_REACHED' ||
    code === 22 ||
    code === 1014
  );
}

function classifyWriteError(e: unknown): BookmarkStorageError {
  // QuotaExceededError（各浏览器 code/name 略有差异），优先按名称/代码判断
  if (isQuotaError(e)) {
    return err(
      'quota',
      '浏览器本地存储空间已满，书签未能写入。可清理浏览器站点数据或导出备份后重试。'
    );
  }
  if (!isStorageAvailable()) {
    return err(
      'unavailable',
      '浏览器本地存储当前不可用（可能处于隐私模式或被策略禁用），无法保存书签。'
    );
  }
  return err('unavailable', `写入本地存储失败：${e instanceof Error ? e.message : String(e)}`);
}

function isValidBookmark(b: any): b is ViewBookmark {
  if (!b || typeof b !== 'object') return false;
  if (typeof b.id !== 'string' || !b.id) return false;
  if (typeof b.seismicId !== 'number') return false;
  if (typeof b.name !== 'string' || !b.name.trim()) return false;
  if (typeof b.createdAt !== 'string' || typeof b.updatedAt !== 'string') return false;
  const v = b.view;
  if (!v || typeof v !== 'object') return false;
  if (!Array.isArray(v.cameraPosition) || v.cameraPosition.length !== 3) return false;
  if (!Array.isArray(v.cameraTarget) || v.cameraTarget.length !== 3) return false;
  if (!v.slices || typeof v.slices !== 'object') return false;
  for (const t of SLICE_TYPES) {
    const s = v.slices[t];
    if (
      !s ||
      typeof s.visible !== 'boolean' ||
      typeof s.opacity !== 'number' ||
      s.opacity < 0 ||
      s.opacity > 1
    ) {
      return false;
    }
  }
  return true;
}

function parseGroup(raw: string | null): ViewBookmark[] {
  if (raw === null || raw === undefined) return [];
  if (raw === '' ) return [];
  let parsed: any;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw err(
      'corrupted',
      '本地保存的书签数据已损坏（无法解析）。可清理浏览器站点数据后重试，或从备份文件导入。'
    );
  }
  const list = Array.isArray(parsed) ? parsed : parsed?.bookmarks;
  if (!Array.isArray(list)) {
    throw err(
      'corrupted',
      '本地保存的书签数据格式不正确，可能已被其他程序破坏。'
    );
  }
  return list.filter(isValidBookmark);
}

/** 读取某个数据体的书签。localStorage 中不存在时视为空列表；疑似被外部清理时抛 cleared 错误。 */
export function loadBookmarks(seismicId: number): ViewBookmark[] {
  let raw: string | null;
  try {
    raw = window.localStorage.getItem(keyFor(seismicId));
  } catch (e) {
    throw err('unavailable', `读取本地存储失败：${e instanceof Error ? e.message : String(e)}`);
  }

  if (raw === null) {
    // 键不存在：可能是从未保存，也可能是数据被浏览器/清理工具清掉。
    // 若 localStorage 中还有其他书签键，说明存储本身可用，只是该数据体的记录缺失。
    let hasOtherBookmarkKeys = false;
    try {
      for (let i = 0; i < window.localStorage.length; i++) {
        const k = window.localStorage.key(i);
        if (k && k.startsWith(KEY_PREFIX)) {
          hasOtherBookmarkKeys = true;
          break;
        }
      }
    } catch {
      hasOtherBookmarkKeys = false;
    }
    if (hasOtherBookmarkKeys) {
      throw err(
        'cleared',
        '未找到该数据体的本地书签记录，可能已被浏览器清理工具或站点数据清理删除。可从备份文件导入或重新保存。'
      );
    }
    return [];
  }

  return parseGroup(raw);
}

/** 读取全部书签（用于导出备份）。某个分组损坏时跳过并通过 onGroupError 回报。 */
export function loadAllBookmarks(
  onGroupError?: (seismicId: number, error: BookmarkStorageError) => void
): ViewBookmark[] {
  if (!isStorageAvailable()) {
    throw err('unavailable', '浏览器本地存储当前不可用，无法读取书签。');
  }

  const all: ViewBookmark[] = [];
  try {
    for (let i = 0; i < window.localStorage.length; i++) {
      const k = window.localStorage.key(i);
      if (!k || !k.startsWith(KEY_PREFIX)) continue;
      const idPart = k.slice(KEY_PREFIX.length);
      const seismicId = Number(idPart);
      if (!Number.isFinite(seismicId)) continue;
      try {
        all.push(...parseGroup(window.localStorage.getItem(k)));
      } catch (e) {
        onGroupError?.(seismicId, e as BookmarkStorageError);
      }
    }
  } catch (e) {
    throw err('unavailable', `读取本地存储失败：${e instanceof Error ? e.message : String(e)}`);
  }
  return all;
}

/**
 * 写入书签分组，并立即读回校验，防止"写成功但实际被丢弃"（例如隐私模式静默失败）。
 */
function persistGroup(seismicId: number, bookmarks: ViewBookmark[]): void {
  const payload = JSON.stringify({ bookmarks });
  try {
    window.localStorage.setItem(keyFor(seismicId), payload);
  } catch (e) {
    // 不预先做可用性探针：配额满时探针同样会抛错，会把 quota 误判成不可用。
    throw classifyWriteError(e);
  }

  // 写入后读回校验
  let readBack: string | null = null;
  try {
    readBack = window.localStorage.getItem(keyFor(seismicId));
  } catch {
    // 读失败在下面统一处理
  }
  if (readBack !== payload) {
    throw err(
      'cleared',
      '书签写入后未能从本地存储读回，可能已被浏览器立即清理（常见于隐私模式或存储被限制）。请调整浏览器设置后重试。'
    );
  }
}

export function saveBookmark(seismicId: number, bookmark: ViewBookmark): ViewBookmark[] {
  const list = readOrEmpty(seismicId);
  const index = list.findIndex((b) => b.id === bookmark.id);
  if (index >= 0) list[index] = bookmark;
  else list.push(bookmark);
  persistGroup(seismicId, list);
  return list;
}

export function renameBookmark(
  seismicId: number,
  bookmarkId: string,
  name: string,
  timestamp: string
): ViewBookmark[] {
  const list = loadBookmarks(seismicId);
  const target = list.find((b) => b.id === bookmarkId);
  if (!target) {
    throw err(
      'cleared',
      '要改名的书签在本地存储中已不存在，可能已被清理。请刷新列表后重试。'
    );
  }
  target.name = name;
  target.updatedAt = timestamp;
  persistGroup(seismicId, list);
  return list;
}

export function deleteBookmark(seismicId: number, bookmarkId: string): ViewBookmark[] {
  // 删除只影响指定书签：以当前分组为基准过滤，其他分组/数据一律不触碰。
  const list = readOrEmpty(seismicId).filter((b) => b.id !== bookmarkId);
  persistGroup(seismicId, list);
  return list;
}

/** 写入失败/损坏后重试时使用：直接以传入列表覆盖该数据体的分组。 */
export function replaceBookmarks(seismicId: number, bookmarks: ViewBookmark[]): ViewBookmark[] {
  persistGroup(seismicId, bookmarks);
  return bookmarks;
}

function readOrEmpty(seismicId: number): ViewBookmark[] {
  try {
    return loadBookmarks(seismicId);
  } catch (e) {
    if ((e as BookmarkStorageError).type === 'cleared') return [];
    throw e;
  }
}

/** 校验并规范化导入文件。 */
export function parseImportFile(text: string): {
  datasets: Record<string, { seismicName?: string; bookmarks: ViewBookmark[] }>;
  total: number;
  skipped: number;
} {
  let data: any;
  try {
    data = JSON.parse(text);
  } catch {
    throw err('invalid', '导入文件不是有效的 JSON 文件，请选择书签备份文件（.json）。');
  }

  if (
    !data ||
    data.kind !== 'view-bookmarks' ||
    typeof data.datasets !== 'object'
  ) {
    throw err('invalid', '文件内容不是视图书签备份格式，请确认选择的是本系统导出的书签文件。');
  }

  const datasets: BookmarkExportFile['datasets'] = {};
  let total = 0;
  let skipped = 0;

  Object.entries<any>(data.datasets).forEach(([idKey, group]) => {
    const seismicId = Number(idKey);
    if (!Number.isFinite(seismicId) || !group || !Array.isArray(group.bookmarks)) {
      skipped += Array.isArray(group?.bookmarks) ? group.bookmarks.length : 0;
      return;
    }
    const valid: ViewBookmark[] = [];
    for (const b of group.bookmarks) {
      if (isValidBookmark(b)) {
        valid.push({ ...b, seismicId });
      } else {
        skipped++;
      }
    }
    datasets[String(seismicId)] = {
      seismicName: typeof group.seismicName === 'string' ? group.seismicName : undefined,
      bookmarks: valid,
    };
    total += valid.length;
  });

  if (total === 0) {
    throw err('invalid', skipped > 0
      ? '文件中的书签条目均无法通过校验，未导入任何书签。'
      : '文件中没有找到可导入的书签。');
  }

  return { datasets, total, skipped };
}

/** 合并导入的书签到本地存储，返回合并后各分组及冲突信息。 */
export function mergeImport(
  datasets: BookmarkExportFile['datasets'],
  strategy: 'skip' | 'rename' | 'overwrite',
  makeTimestamp: () => string
): { merged: Record<number, ViewBookmark[]>; imported: number; conflicts: number } {
  const merged: Record<number, ViewBookmark[]> = {};
  let imported = 0;
  let conflicts = 0;

  for (const [idKey, group] of Object.entries(datasets)) {
    const seismicId = Number(idKey);
    const existing = readOrEmpty(seismicId);
    const byId = new Map(existing.map((b) => [b.id, b]));
    const byName = new Map(existing.map((b) => [b.name.trim(), b]));
    const usedNames = new Set(existing.map((b) => b.name.trim()));

    for (const incoming of group.bookmarks) {
      const sameId = byId.get(incoming.id);
      const nameTaken = usedNames.has(incoming.name.trim());
      if (sameId || nameTaken) {
        conflicts++;
        if (strategy === 'skip') continue;
        if (strategy === 'rename') {
          let candidate = `${incoming.name}（导入）`;
          let n = 2;
          while (usedNames.has(candidate.trim())) {
            candidate = `${incoming.name}（导入 ${n}）`;
            n++;
          }
          const renamed: ViewBookmark = {
            ...incoming,
            // 与本地同 id 时另分配 id，使两条都能保留
            id: sameId ? `${incoming.id}-imp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}` : incoming.id,
            name: candidate,
            updatedAt: makeTimestamp(),
          };
          byId.set(renamed.id, renamed);
          byName.set(renamed.name.trim(), renamed);
          usedNames.add(renamed.name.trim());
          imported++;
          continue;
        }
        // overwrite：以导入条目为准。若本地存在同名但不同 id 的条目，将其移除，避免残留两条。
        const overwritten: ViewBookmark = { ...incoming, updatedAt: makeTimestamp() };
        const localByName = byName.get(overwritten.name.trim());
        if (localByName && localByName.id !== overwritten.id) {
          byId.delete(localByName.id);
        }
        if (sameId && sameId.name.trim() !== overwritten.name.trim()) {
          usedNames.delete(sameId.name.trim());
          byName.delete(sameId.name.trim());
        }
        byId.set(overwritten.id, overwritten);
        byName.set(overwritten.name.trim(), overwritten);
        usedNames.add(overwritten.name.trim());
        imported++;
        continue;
      }
      byId.set(incoming.id, incoming);
      byName.set(incoming.name.trim(), incoming);
      usedNames.add(incoming.name.trim());
      imported++;
    }

    const list = Array.from(byId.values());
    persistGroup(seismicId, list);
    merged[seismicId] = list;
  }

  return { merged, imported, conflicts };
}

/** 构造导出文件内容。 */
export function buildExportFile(allBookmarks: ViewBookmark[]): BookmarkExportFile {
  const datasets: BookmarkExportFile['datasets'] = {};
  for (const b of allBookmarks) {
    const key = String(b.seismicId);
    if (!datasets[key]) datasets[key] = { seismicName: b.seismicName, bookmarks: [] };
    datasets[key].bookmarks.push(b);
  }
  return {
    app: APP_NAME,
    kind: 'view-bookmarks',
    version: EXPORT_VERSION,
    exportedAt: new Date().toISOString(),
    datasets,
  };
}
