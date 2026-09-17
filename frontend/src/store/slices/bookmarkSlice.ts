import { createSlice, createAsyncThunk, PayloadAction } from '@reduxjs/toolkit';
import {
  ViewBookmark,
  BookmarkView,
  BookmarkStorageError,
  BookmarkExportFile,
  BookmarkImportStrategy,
} from '../../types';
import * as storage from '../../services/bookmarkStorage';

interface BookmarkState {
  /** 当前数据体的书签列表 */
  bookmarks: ViewBookmark[];
  /** 当前列表所属的数据体 id（null 表示尚未加载） */
  loadedSeismicId: number | null;
  loading: boolean;
  /** 最近一次存储错误（加载/保存/改名/删除/导入），用于在界面上指出原因 */
  error: BookmarkStorageError | null;
  /** 发生错误时的场景描述，方便给出针对性的重试提示 */
  errorContext: string | null;
  /** 上一次操作类型，用于"重试"时还原操作 */
  lastFailedAction:
    | { kind: 'load'; seismicId: number }
    | { kind: 'save'; seismicId: number; bookmark: ViewBookmark }
    | { kind: 'rename'; seismicId: number; bookmarkId: string; name: string }
    | { kind: 'delete'; seismicId: number; bookmarkId: string }
    | { kind: 'import'; datasets: BookmarkExportFile['datasets']; strategy: BookmarkImportStrategy; skipped: number }
    | null;
  /** 导入结果摘要 */
  lastImport: { imported: number; skipped: number; conflicts: number } | null;
}

const initialState: BookmarkState = {
  bookmarks: [],
  loadedSeismicId: null,
  loading: false,
  error: null,
  errorContext: null,
  lastFailedAction: null,
  lastImport: null,
};

const now = () => new Date().toISOString();

function genId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `bm-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export const loadBookmarks = createAsyncThunk(
  'bookmarks/load',
  async (seismicId: number, { rejectWithValue }) => {
    try {
      const bookmarks = storage.loadBookmarks(seismicId);
      return { seismicId, bookmarks };
    } catch (e) {
      return rejectWithValue({ error: e as BookmarkStorageError });
    }
  }
);

export const addBookmark = createAsyncThunk(
  'bookmarks/add',
  async (
    payload: { seismicId: number; seismicName?: string; name: string; view: BookmarkView },
    { rejectWithValue }
  ) => {
    const bookmark: ViewBookmark = {
      id: genId(),
      seismicId: payload.seismicId,
      seismicName: payload.seismicName,
      name: payload.name.trim(),
      view: payload.view,
      createdAt: now(),
      updatedAt: now(),
    };
    try {
      const bookmarks = storage.saveBookmark(payload.seismicId, bookmark);
      return { seismicId: payload.seismicId, bookmarks, bookmark };
    } catch (e) {
      return rejectWithValue({ error: e as BookmarkStorageError, bookmark });
    }
  }
);

export const saveBookmarkObject = createAsyncThunk(
  'bookmarks/saveObject',
  async (bookmark: ViewBookmark, { rejectWithValue }) => {
    try {
      const bookmarks = storage.saveBookmark(bookmark.seismicId, bookmark);
      return { seismicId: bookmark.seismicId, bookmarks, bookmark };
    } catch (e) {
      return rejectWithValue({ error: e as BookmarkStorageError, bookmark });
    }
  }
);

export const renameBookmark = createAsyncThunk(
  'bookmarks/rename',
  async (
    payload: { seismicId: number; bookmarkId: string; name: string },
    { rejectWithValue }
  ) => {
    try {
      const bookmarks = storage.renameBookmark(
        payload.seismicId,
        payload.bookmarkId,
        payload.name.trim(),
        now()
      );
      return { seismicId: payload.seismicId, bookmarks };
    } catch (e) {
      return rejectWithValue({ error: e as BookmarkStorageError });
    }
  }
);

export const deleteBookmark = createAsyncThunk(
  'bookmarks/delete',
  async (payload: { seismicId: number; bookmarkId: string }, { rejectWithValue }) => {
    try {
      const bookmarks = storage.deleteBookmark(payload.seismicId, payload.bookmarkId);
      return { seismicId: payload.seismicId, bookmarks, bookmarkId: payload.bookmarkId };
    } catch (e) {
      return rejectWithValue({ error: e as BookmarkStorageError });
    }
  }
);

export const importBookmarks = createAsyncThunk(
  'bookmarks/import',
  async (
    payload: { datasets: BookmarkExportFile['datasets']; strategy: BookmarkImportStrategy; skipped: number },
    { rejectWithValue }
  ) => {
    try {
      const result = storage.mergeImport(payload.datasets, payload.strategy, now);
      return { ...result, skipped: payload.skipped };
    } catch (e) {
      return rejectWithValue({ error: e as BookmarkStorageError, datasets: payload.datasets, strategy: payload.strategy });
    }
  }
);

/** 依据 lastFailedAction 重试上一次失败的操作。 */
export const retryLastAction = createAsyncThunk(
  'bookmarks/retry',
  async (_: void, { dispatch, getState }) => {
    const state = (getState() as Rootish).bookmarks;
    const failed = state.lastFailedAction;
    if (!failed) return;

    if (failed.kind === 'load') {
      return dispatch(loadBookmarks(failed.seismicId));
    }
    if (failed.kind === 'save') {
      return dispatch(saveBookmarkObject(failed.bookmark));
    }
    if (failed.kind === 'rename') {
      return dispatch(
        renameBookmark({
          seismicId: failed.seismicId,
          bookmarkId: failed.bookmarkId,
          name: failed.name,
        })
      );
    }
    if (failed.kind === 'delete') {
      return dispatch(deleteBookmark({ seismicId: failed.seismicId, bookmarkId: failed.bookmarkId }));
    }
    return dispatch(
      importBookmarks({ datasets: failed.datasets, strategy: failed.strategy, skipped: failed.skipped })
    );
  }
);

// 避免循环引入 RootState 类型，这里只取所需字段
type Rootish = { bookmarks: BookmarkState };

const CONTEXT_LABELS: Record<string, string> = {
  load: '读取书签',
  save: '保存书签',
  rename: '书签改名',
  delete: '删除书签',
  import: '导入书签',
};

const bookmarkSlice = createSlice({
  name: 'bookmarks',
  initialState,
  reducers: {
    clearBookmarkError: (state) => {
      state.error = null;
      state.errorContext = null;
      state.lastFailedAction = null;
    },
    clearImportResult: (state) => {
      state.lastImport = null;
    },
  },
  extraReducers: (builder) => {
    builder
      // load
      .addCase(loadBookmarks.pending, (state, action) => {
        state.loading = true;
        state.error = null;
        state.errorContext = null;
        state.lastFailedAction = { kind: 'load', seismicId: action.meta.arg };
      })
      .addCase(loadBookmarks.fulfilled, (state, action) => {
        state.loading = false;
        state.bookmarks = action.payload.bookmarks;
        state.loadedSeismicId = action.payload.seismicId;
        state.error = null;
        state.errorContext = null;
        state.lastFailedAction = null;
      })
      .addCase(loadBookmarks.rejected, (state, action) => {
        state.loading = false;
        const { error } = (action.payload || {}) as { error?: BookmarkStorageError };
        state.error = error ?? { type: 'unavailable', message: '读取书签失败' };
        state.errorContext = CONTEXT_LABELS.load;
      })
      // add
      .addCase(addBookmark.pending, (state) => {
        state.loading = true;
      })
      // rename
      .addCase(renameBookmark.pending, (state, action) => {
        state.loading = true;
        state.lastFailedAction = {
          kind: 'rename',
          seismicId: action.meta.arg.seismicId,
          bookmarkId: action.meta.arg.bookmarkId,
          name: action.meta.arg.name,
        };
      })
      .addCase(renameBookmark.fulfilled, (state, action) => {
        state.loading = false;
        state.bookmarks = action.payload.bookmarks;
        state.loadedSeismicId = action.payload.seismicId;
        state.error = null;
        state.errorContext = null;
        state.lastFailedAction = null;
      })
      .addCase(renameBookmark.rejected, (state, action) => {
        state.loading = false;
        const { error } = (action.payload || {}) as { error?: BookmarkStorageError };
        state.error = error ?? { type: 'unavailable', message: '书签改名失败' };
        state.errorContext = CONTEXT_LABELS.rename;
      })
      // delete
      .addCase(deleteBookmark.pending, (state, action) => {
        state.loading = true;
        state.lastFailedAction = {
          kind: 'delete',
          seismicId: action.meta.arg.seismicId,
          bookmarkId: action.meta.arg.bookmarkId,
        };
      })
      .addCase(deleteBookmark.fulfilled, (state, action) => {
        state.loading = false;
        state.bookmarks = action.payload.bookmarks;
        state.loadedSeismicId = action.payload.seismicId;
        state.error = null;
        state.errorContext = null;
        state.lastFailedAction = null;
      })
      .addCase(deleteBookmark.rejected, (state, action) => {
        state.loading = false;
        const { error } = (action.payload || {}) as { error?: BookmarkStorageError };
        state.error = error ?? { type: 'unavailable', message: '删除书签失败' };
        state.errorContext = CONTEXT_LABELS.delete;
      })
      // import
      .addCase(importBookmarks.pending, (state, action) => {
        state.loading = true;
        state.lastFailedAction = {
          kind: 'import',
          datasets: action.meta.arg.datasets,
          strategy: action.meta.arg.strategy,
          skipped: action.meta.arg.skipped,
        };
      })
      .addCase(importBookmarks.fulfilled, (state, action) => {
        state.loading = false;
        state.error = null;
        state.errorContext = null;
        state.lastFailedAction = null;
        state.lastImport = {
          imported: action.payload.imported,
          skipped: action.payload.skipped,
          conflicts: action.payload.conflicts,
        };
        // 若导入结果包含当前数据体，刷新当前列表
        const current = action.payload.merged[state.loadedSeismicId ?? -1];
        if (current) state.bookmarks = current;
      })
      .addCase(importBookmarks.rejected, (state, action) => {
        state.loading = false;
        const { error } = (action.payload || {}) as { error?: BookmarkStorageError };
        state.error = error ?? { type: 'unavailable', message: '导入书签失败' };
        state.errorContext = CONTEXT_LABELS.import;
      })
      // 新增保存与失败重试共用同一套状态处理（matcher 必须放在 addCase 之后）
      .addMatcher(
        (action) =>
          action.type === addBookmark.fulfilled.type ||
          action.type === saveBookmarkObject.fulfilled.type,
        (state, action: any) => {
          state.loading = false;
          state.bookmarks = action.payload.bookmarks;
          state.loadedSeismicId = action.payload.seismicId;
          state.error = null;
          state.errorContext = null;
          state.lastFailedAction = null;
        }
      )
      .addMatcher(
        (action) =>
          action.type === addBookmark.rejected.type ||
          action.type === saveBookmarkObject.rejected.type,
        (state, action: any) => {
          state.loading = false;
          const { error, bookmark } = (action.payload || {}) as {
            error?: BookmarkStorageError;
            bookmark?: ViewBookmark;
          };
          state.error = error ?? { type: 'unavailable', message: '保存书签失败' };
          state.errorContext = CONTEXT_LABELS.save;
          if (bookmark) {
            state.lastFailedAction = {
              kind: 'save',
              seismicId: bookmark.seismicId,
              bookmark,
            };
          }
        }
      );
  },
});

export const { clearBookmarkError, clearImportResult } = bookmarkSlice.actions;
export default bookmarkSlice.reducer;
