import { createSlice, createAsyncThunk, PayloadAction } from '@reduxjs/toolkit';
import { ViewBookmark, BookmarkView } from '../../types';
import {
  loadBookmarks,
  saveBookmarks,
  createBookmarkId,
  BookmarkStorageError,
  describeStorageError,
  BookmarkStorageReason,
} from '../../services/bookmarkStorage';

interface BookmarkState {
  /** 按地震数据 ID 分组的书签 */
  bySeismic: Record<number, ViewBookmark[]>;
  /** 是否已完成首次本地加载 */
  loaded: boolean;
  /** 首次读取本地存储失败的原因 */
  loadError: { reason: BookmarkStorageReason | 'unknown'; message: string } | null;
  /** 读取时的非致命提示（数据损坏 / 格式不符） */
  warning: string | null;
  /** 最近一次写入失败的信息，界面据此提示原因并提供重试 */
  writeError: { reason: BookmarkStorageReason; message: string; at: number } | null;
  /** 本地数据被浏览器或其它页面清理 */
  storageCleared: boolean;
  busy: boolean;
}

const initialState: BookmarkState = {
  bySeismic: {},
  loaded: false,
  loadError: null,
  warning: null,
  writeError: null,
  storageCleared: false,
  busy: false,
};

/** 首次从本地存储读取书签 */
export const initBookmarks = createAsyncThunk('bookmarks/init', async (_, { rejectWithValue }) => {
  try {
    return loadBookmarks();
  } catch (error) {
    const reason = error instanceof BookmarkStorageError ? error.reason : 'unknown';
    return rejectWithValue({ reason, message: describeStorageError(error) });
  }
});

/** 将内存中的全部书签写入本地存储（也用于失败后的重试） */
export const persistBookmarks = createAsyncThunk(
  'bookmarks/persist',
  async (_: void, { getState, dispatch }) => {
    const all = selectAllBookmarks(getState() as any);
    try {
      saveBookmarks(all);
      return true;
    } catch (error) {
      const reason = error instanceof BookmarkStorageError ? error.reason : 'unknown';
      const message = describeStorageError(error);
      dispatch(bookmarkSlice.actions.persistFailed({ reason, message }));
      return false;
    }
  }
);

export interface AddBookmarkPayload {
  seismicId: number;
  name: string;
  view: BookmarkView;
}

/** 新增书签；重名由调用方在界面层拦截，这里再兜底拒绝一次 */
export const addBookmark = createAsyncThunk(
  'bookmarks/add',
  async (payload: AddBookmarkPayload, { getState, dispatch, rejectWithValue }) => {
    const state = getState() as any;
    const list = selectBookmarksForSeismic(state, payload.seismicId);
    if (list.some((b: ViewBookmark) => b.name === payload.name)) {
      return rejectWithValue({ duplicate: true });
    }
    const now = Date.now();
    const bookmark: ViewBookmark = {
      id: createBookmarkId(),
      seismicId: payload.seismicId,
      name: payload.name,
      view: payload.view,
      createdAt: now,
      updatedAt: now,
    };
    dispatch(bookmarkSlice.actions.upsertBookmark(bookmark));
    const persisted = await dispatch(persistBookmarks());
    if (persisted.payload === false) {
      // 内存中已加入，但写入本地失败：界面提示原因并允许重试
      return rejectWithValue({ storageError: true });
    }
    return bookmark;
  }
);

/** 重命名书签 */
export const renameBookmark = createAsyncThunk(
  'bookmarks/rename',
  async (
    payload: { id: string; seismicId: number; name: string },
    { getState, dispatch, rejectWithValue }
  ) => {
    const state = getState() as any;
    const list = selectBookmarksForSeismic(state, payload.seismicId);
    if (list.some((b: ViewBookmark) => b.name === payload.name && b.id !== payload.id)) {
      return rejectWithValue({ duplicate: true });
    }
    const target = list.find((b: ViewBookmark) => b.id === payload.id);
    if (!target) return rejectWithValue({ notFound: true });

    dispatch(
      bookmarkSlice.actions.updateBookmark({
        id: payload.id,
        seismicId: payload.seismicId,
        patch: { name: payload.name, updatedAt: Date.now() },
      })
    );
    const persisted = await dispatch(persistBookmarks());
    if (persisted.payload === false) {
      return rejectWithValue({ storageError: true });
    }
    return true;
  }
);

/** 删除单条书签，不触碰其它书签 */
export const deleteBookmark = createAsyncThunk(
  'bookmarks/delete',
  async (payload: { id: string; seismicId: number }, { dispatch, rejectWithValue }) => {
    dispatch(bookmarkSlice.actions.removeBookmark(payload));
    const persisted = await dispatch(persistBookmarks());
    if (persisted.payload === false) {
      return rejectWithValue({ storageError: true });
    }
    return true;
  }
);

/** 导入书签；重名条目由调用方改好名字后传入，这里直接整体合并写入 */
export const importBookmarks = createAsyncThunk(
  'bookmarks/import',
  async (bookmarks: ViewBookmark[], { dispatch, rejectWithValue }) => {
    bookmarks.forEach((bookmark) => {
      dispatch(bookmarkSlice.actions.upsertBookmark(bookmark));
    });
    const persisted = await dispatch(persistBookmarks());
    if (persisted.payload === false) {
      return rejectWithValue({ storageError: true, count: bookmarks.length });
    }
    return bookmarks.length;
  }
);

// ---------- 选择器 ----------

export const selectAllBookmarks = (state: { bookmarks: BookmarkState }): ViewBookmark[] =>
  Object.values(state.bookmarks.bySeismic).flat();

export const selectBookmarksForSeismic = (
  state: { bookmarks: BookmarkState },
  seismicId: number
): ViewBookmark[] =>
  (state.bookmarks.bySeismic[seismicId] || []).slice().sort((a, b) => b.createdAt - a.createdAt);

const bookmarkSlice = createSlice({
  name: 'bookmarks',
  initialState,
  reducers: {
    /** 用本地存储中的完整列表替换内存（外部页面改动 / 清理后同步） */
    replaceAll: (state, action: PayloadAction<ViewBookmark[]>) => {
      const grouped: Record<number, ViewBookmark[]> = {};
      for (const bookmark of action.payload) {
        (grouped[bookmark.seismicId] ||= []).push(bookmark);
      }
      state.bySeismic = grouped;
      state.storageCleared = false;
      state.loadError = null;
    },
    markStorageCleared: (state) => {
      // 本地数据被清空：保留内存中的副本，让用户可以重试写回
      state.storageCleared = true;
    },
    clearWarning: (state) => {
      state.warning = null;
    },
    clearWriteError: (state) => {
      state.writeError = null;
    },
    /** 内部使用：新增或替换单条 */
    upsertBookmark: (state, action: PayloadAction<ViewBookmark>) => {
      const bookmark = action.payload;
      const list = state.bySeismic[bookmark.seismicId] || [];
      const index = list.findIndex((b) => b.id === bookmark.id);
      if (index === -1) list.push(bookmark);
      else list[index] = bookmark;
      state.bySeismic[bookmark.seismicId] = list;
    },
    /** 内部使用：更新单条字段 */
    updateBookmark: (
      state,
      action: PayloadAction<{
        id: string;
        seismicId: number;
        patch: Partial<ViewBookmark>;
      }>
    ) => {
      const { id, seismicId, patch } = action.payload;
      const list = state.bySeismic[seismicId] || [];
      const index = list.findIndex((b) => b.id === id);
      if (index !== -1) {
        list[index] = { ...list[index], ...patch };
      }
    },
    /** 内部使用：删除单条 */
    removeBookmark: (
      state,
      action: PayloadAction<{ id: string; seismicId: number }>
    ) => {
      const { id, seismicId } = action.payload;
      state.bySeismic[seismicId] = (state.bySeismic[seismicId] || []).filter(
        (b) => b.id !== id
      );
    },
    persistFailed: (
      state,
      action: PayloadAction<{ reason: BookmarkStorageReason; message: string }>
    ) => {
      state.writeError = { ...action.payload, at: Date.now() };
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(initBookmarks.pending, (state) => {
        state.busy = true;
      })
      .addCase(initBookmarks.fulfilled, (state, action) => {
        const grouped: Record<number, ViewBookmark[]> = {};
        for (const bookmark of action.payload.bookmarks) {
          (grouped[bookmark.seismicId] ||= []).push(bookmark);
        }
        state.bySeismic = grouped;
        state.warning = action.payload.warning;
        state.loaded = true;
        state.busy = false;
        state.loadError = null;
      })
      .addCase(initBookmarks.rejected, (state, action) => {
        state.busy = false;
        state.loaded = true;
        state.loadError = (action.payload as BookmarkState['loadError']) ?? {
          reason: 'unknown',
          message: '读取本地书签失败，请重试。',
        };
      })
      .addCase(persistBookmarks.fulfilled, (state, action) => {
        if (action.payload) {
          state.writeError = null;
          state.storageCleared = false;
        }
      });
  },
});

export const {
  replaceAll,
  markStorageCleared,
  clearWarning,
  clearWriteError,
} = bookmarkSlice.actions;

export default bookmarkSlice.reducer;
