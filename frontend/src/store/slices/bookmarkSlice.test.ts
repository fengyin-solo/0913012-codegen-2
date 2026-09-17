import { configureStore as createRealStore } from '@reduxjs/toolkit';
import bookmarkReducer, {
  addBookmark,
  deleteBookmark,
  importBookmarks,
  initBookmarks,
  persistBookmarks,
  renameBookmark,
  replaceAll,
  selectAllBookmarks,
  selectBookmarksForSeismic,
} from './bookmarkSlice';
import viewerReducer, {
  addMeasurementPoint,
  applyBookmarkSlices,
  clearMeasurementPoints,
  resetViewer,
  setSliceVisible,
  setTool,
} from './viewerSlice';
import { BookmarkView, ViewBookmark } from '../../types';

const view: BookmarkView = {
  camera: { theta: 0.1, phi: 1.1, radius: 300, target: [0, 0, 0] },
  slices: {
    inline: { visible: true, opacity: 0.4, index: 3 },
    crossline: { visible: true, opacity: 0.5, index: 4 },
    depth: { visible: false, opacity: 1, index: 0 },
  },
};

const buildStore = () =>
  createRealStore({
    reducer: {
      bookmarks: bookmarkReducer,
      viewer: viewerReducer,
    },
  });

describe('bookmarkSlice 状态逻辑', () => {
  it('replaceAll 后按 seismicId 分组，选择器按时间倒序', () => {
    const state = bookmarkReducer(
      undefined,
      replaceAll([
        { id: 'a', seismicId: 1, name: '旧', view, createdAt: 100, updatedAt: 100 },
        { id: 'b', seismicId: 1, name: '新', view, createdAt: 300, updatedAt: 300 },
        { id: 'c', seismicId: 2, name: '别的数据', view, createdAt: 200, updatedAt: 200 },
      ])
    );
    const root = { bookmarks: state } as any;
    expect(selectBookmarksForSeismic(root, 1).map((b) => b.id)).toEqual(['b', 'a']);
    expect(selectBookmarksForSeismic(root, 2)).toHaveLength(1);
    expect(selectAllBookmarks(root)).toHaveLength(3);
  });
});

describe('viewerSlice 与书签的边界', () => {
  it('applyBookmarkSlices 只改切片，不动测量点与工具', () => {
    let state = viewerReducer(undefined, setTool('measure'));
    state = viewerReducer(state, addMeasurementPoint({ x: 1, y: 2, z: 3 }));
    state = viewerReducer(
      state,
      applyBookmarkSlices({
        inline: { visible: true, opacity: 0.25, index: 8 },
        depth: { visible: true, opacity: 0.7, index: 9 },
      })
    );

    expect(state.slices.inline.visible).toBe(true);
    expect(state.slices.inline.opacity).toBeCloseTo(0.25);
    expect(state.slices.inline.index).toBe(8);
    expect(state.slices.depth.visible).toBe(true);
    // 未提供的 crossline 保持原样
    expect(state.slices.crossline.visible).toBe(false);
    // 工具与测量点不受影响
    expect(state.tool).toBe('measure');
    expect(state.measurementPoints).toEqual([{ x: 1, y: 2, z: 3 }]);
  });

  it('清除测量点与重置视图保持原有行为', () => {
    let state = viewerReducer(undefined, setTool('measure'));
    state = viewerReducer(state, addMeasurementPoint({ x: 1, y: 2, z: 3 }));
    state = viewerReducer(state, setSliceVisible({ sliceType: 'inline', visible: true }));
    state = viewerReducer(state, clearMeasurementPoints());
    expect(state.measurementPoints).toEqual([]);
    expect(state.slices.inline.visible).toBe(true);

    const reset = viewerReducer(state, resetViewer());
    expect(reset.tool).toBe('rotate');
    expect(reset.slices.inline.visible).toBe(false);
    expect(reset.zoom).toBe(1);
  });
});

describe('书签增删改与持久化（真实 store + localStorage）', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('新增后写入本地，重名被拒绝', async () => {
    const store = buildStore();
    const ok = await store.dispatch(addBookmark({ seismicId: 1, name: '视图 A', view }));
    expect(ok.meta.requestStatus).toBe('fulfilled');
    expect(selectBookmarksForSeismic(store.getState(), 1)).toHaveLength(1);
    expect(window.localStorage.getItem('seismic-view-bookmarks:v1')).not.toBeNull();

    const dup = await store.dispatch(addBookmark({ seismicId: 1, name: '视图 A', view }));
    expect(dup.meta.requestStatus).toBe('rejected');
    // 重名没有产生多余条目，也没有覆盖原条目
    expect(selectBookmarksForSeismic(store.getState(), 1)).toHaveLength(1);
  });

  it('删除一条只影响这一条', async () => {
    const store = buildStore();
    await store.dispatch(addBookmark({ seismicId: 1, name: 'A', view }));
    await store.dispatch(addBookmark({ seismicId: 1, name: 'B', view }));
    const before = selectBookmarksForSeismic(store.getState(), 1);
    const target = before.find((b) => b.name === 'A')!;

    await store.dispatch(deleteBookmark({ id: target.id, seismicId: 1 }));

    const after = selectBookmarksForSeismic(store.getState(), 1);
    expect(after.map((b) => b.name)).toEqual(['B']);
  });

  it('重命名成功，改成已存在的名字被拒绝', async () => {
    const store = buildStore();
    await store.dispatch(addBookmark({ seismicId: 1, name: 'A', view }));
    await store.dispatch(addBookmark({ seismicId: 1, name: 'B', view }));
    const target = selectBookmarksForSeismic(store.getState(), 1).find(
      (b) => b.name === 'A'
    )!;

    const renamed = await store.dispatch(
      renameBookmark({ id: target.id, seismicId: 1, name: 'A-改名' })
    );
    expect(renamed.meta.requestStatus).toBe('fulfilled');

    const conflict = await store.dispatch(
      renameBookmark({ id: target.id, seismicId: 1, name: 'B' })
    );
    expect(conflict.meta.requestStatus).toBe('rejected');
    expect(
      selectBookmarksForSeismic(store.getState(), 1).map((b) => b.name).sort()
    ).toEqual(['A-改名', 'B']);
  });

  it('导入合并多个数据的书签，init 后能重新读回', async () => {
    const store = buildStore();
    const incoming: ViewBookmark[] = [
      { id: 'x1', seismicId: 1, name: '导入1', view, createdAt: 1, updatedAt: 1 },
      { id: 'x2', seismicId: 2, name: '导入2', view, createdAt: 2, updatedAt: 2 },
    ];
    const result = await store.dispatch(importBookmarks(incoming));
    expect(result.payload).toBe(2);

    // 模拟“从别的页面返回”后重新初始化
    const fresh = buildStore();
    await fresh.dispatch(initBookmarks());
    expect(selectBookmarksForSeismic(fresh.getState(), 1).map((b) => b.name)).toEqual([
      '导入1',
    ]);
    expect(selectBookmarksForSeismic(fresh.getState(), 2).map((b) => b.name)).toEqual([
      '导入2',
    ]);
  });

  it('写入失败时记录原因，数据保留在内存，重试成功后清除错误', async () => {
    const store = buildStore();
    const setItemSpy = jest
      .spyOn(Storage.prototype, 'setItem')
      .mockImplementation(() => {
        throw new DOMException('quota', 'QuotaExceededError');
      });

    const failed = await store.dispatch(addBookmark({ seismicId: 1, name: 'A', view }));
    expect(failed.meta.requestStatus).toBe('rejected');
    // 内存中仍保留，用户不会丢数据
    expect(selectBookmarksForSeismic(store.getState(), 1)).toHaveLength(1);
    expect(store.getState().bookmarks.writeError?.reason).toBe('quota');

    setItemSpy.mockRestore();
    const retry = await store.dispatch(
      // 直接重试持久化（界面“重试写入”按钮的动作）
      persistBookmarks()
    );
    expect(retry.payload).toBe(true);
    expect(store.getState().bookmarks.writeError).toBeNull();
    expect(window.localStorage.getItem('seismic-view-bookmarks:v1')).not.toBeNull();
  });
});
