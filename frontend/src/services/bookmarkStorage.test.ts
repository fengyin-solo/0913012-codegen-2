import {
  buildExportFile,
  loadBookmarks,
  normalizeBookmark,
  parseImportFile,
  saveBookmarks,
  BookmarkStorageError,
} from './bookmarkStorage';
import { ViewBookmark } from '../types';

const STORAGE_KEY = 'seismic-view-bookmarks:v1';

const sampleBookmark = (overrides: Partial<ViewBookmark> = {}): ViewBookmark => ({
  id: 'bm-1',
  seismicId: 7,
  name: '顶视图',
  view: {
    camera: { theta: 0.5, phi: 1.2, radius: 420, target: [1, 2, 3] },
    slices: {
      inline: { visible: true, opacity: 0.8, index: 10 },
      crossline: { visible: false, opacity: 1, index: 0 },
      depth: { visible: true, opacity: 0.3, index: 22 },
    },
  },
  createdAt: 1000,
  updatedAt: 1000,
  ...overrides,
});

describe('bookmarkStorage', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('在本地为空时返回空列表', () => {
    const result = loadBookmarks();
    expect(result.bookmarks).toEqual([]);
    expect(result.warning).toBeNull();
  });

  it('保存后可以原样读回', () => {
    const bookmark = sampleBookmark();
    saveBookmarks([bookmark]);
    const result = loadBookmarks();
    expect(result.bookmarks).toHaveLength(1);
    expect(result.bookmarks[0].name).toBe('顶视图');
    expect(result.bookmarks[0].view.slices.inline.opacity).toBeCloseTo(0.8);
  });

  it('数据损坏时给出说明而不是抛错', () => {
    window.localStorage.setItem(STORAGE_KEY, '{不是合法的 JSON');
    const result = loadBookmarks();
    expect(result.bookmarks).toEqual([]);
    expect(result.warning).toContain('损坏');
  });

  it('存储空间不足时抛出归类为 quota 的错误', () => {
    const storage = window.localStorage;
    const setItemSpy = jest
      .spyOn(Storage.prototype, 'setItem')
      .mockImplementation(() => {
        const error = new DOMException('quota', 'QuotaExceededError');
        throw error;
      });

    expect(() => saveBookmarks([sampleBookmark()])).toThrow(BookmarkStorageError);
    try {
      saveBookmarks([sampleBookmark()]);
    } catch (error) {
      expect((error as BookmarkStorageError).reason).toBe('quota');
    }
    setItemSpy.mockRestore();
    expect(storage).toBeDefined();
  });

  it('normalizeBookmark 拒绝结构不完整的条目', () => {
    expect(normalizeBookmark(null)).toBeNull();
    expect(normalizeBookmark({ id: 'x' })).toBeNull();
    const bad = {
      ...sampleBookmark(),
      view: {
        ...sampleBookmark().view,
        camera: { theta: 1, phi: 1, radius: 1, target: [0, 0] },
      },
    };
    expect(normalizeBookmark(bad)).toBeNull();
    expect(normalizeBookmark(sampleBookmark())?.id).toBe('bm-1');
  });

  it('导出文件带有固定标识，解析导入时能识别', () => {
    const file = buildExportFile([sampleBookmark()]);
    expect(file.kind).toBe('seismic-view-bookmarks');
    const parsed = parseImportFile(JSON.stringify(file));
    expect(parsed.bookmarks).toHaveLength(1);
    expect(parsed.invalidCount).toBe(0);
  });

  it('导入内容不是 JSON 时给出明确原因', () => {
    expect(() => parseImportFile('not json')).toThrow('JSON');
  });

  it('导入缺少标识的文件时被拒绝', () => {
    expect(() => parseImportFile(JSON.stringify({ kind: 'other', bookmarks: [] }))).toThrow();
  });

  it('导入时跳过无效条目并计数', () => {
    const file = buildExportFile([sampleBookmark(), sampleBookmark({ id: 'bm-2' })]);
    const broken = JSON.parse(JSON.stringify(file));
    broken.bookmarks[1].view.camera = null;
    const parsed = parseImportFile(JSON.stringify(broken));
    expect(parsed.bookmarks).toHaveLength(1);
    expect(parsed.invalidCount).toBe(1);
  });

  it('兼容直接是书签数组的文件', () => {
    const parsed = parseImportFile(JSON.stringify([sampleBookmark()]));
    expect(parsed.bookmarks).toHaveLength(1);
  });
});
