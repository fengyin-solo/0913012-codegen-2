import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Badge,
  Button,
  Alert,
  Empty,
  Input,
  List,
  Modal,
  Popover,
  Space,
  Tooltip,
  Typography,
  message,
} from 'antd';
import {
  StarOutlined,
  CameraOutlined,
  DeleteOutlined,
  EditOutlined,
  ExportOutlined,
  ImportOutlined,
  ReloadOutlined,
  SaveOutlined,
} from '@ant-design/icons';
import { useDispatch, useSelector } from 'react-redux';
import { AppDispatch, RootState } from '../store';
import { ViewBookmark } from '../types';
import {
  addBookmark,
  clearWarning,
  deleteBookmark,
  importBookmarks,
  initBookmarks,
  markStorageCleared,
  persistBookmarks,
  renameBookmark,
  replaceAll,
  selectBookmarksForSeismic,
} from '../store/slices/bookmarkSlice';
import { applyBookmarkSlices } from '../store/slices/viewerSlice';
import { cameraBridge } from '../services/cameraBridge';
import {
  BOOKMARK_STORAGE_KEY,
  buildExportFile,
  createBookmarkId,
  describeStorageError,
  downloadBookmarkFile,
  loadBookmarks,
  parseImportFile,
} from '../services/bookmarkStorage';

const { Text } = Typography;

interface ViewBookmarksProps {
  seismicId: number;
}

/** 生成不重名的名字：已存在时追加“ 2”“ 3”…… */
function uniqueName(base: string, existing: string[]): string {
  const used = new Set(existing);
  if (!used.has(base)) return base;
  let suffix = 2;
  let candidate = `${base} ${suffix}`;
  while (used.has(candidate) && suffix < 10000) {
    suffix += 1;
    candidate = `${base} ${suffix}`;
  }
  return candidate;
}

const ViewBookmarks: React.FC<ViewBookmarksProps> = ({ seismicId }) => {
  const dispatch = useDispatch<AppDispatch>();
  const bookmarks = useSelector((state: RootState) =>
    selectBookmarksForSeismic(state, seismicId)
  );
  const allBookmarks = useSelector((state: RootState) =>
    Object.values(state.bookmarks.bySeismic).flat()
  );
  const loaded = useSelector((state: RootState) => state.bookmarks.loaded);
  const loadError = useSelector((state: RootState) => state.bookmarks.loadError);
  const warning = useSelector((state: RootState) => state.bookmarks.warning);
  const writeError = useSelector((state: RootState) => state.bookmarks.writeError);
  const storageCleared = useSelector((state: RootState) => state.bookmarks.storageCleared);
  const slices = useSelector((state: RootState) => state.viewer.slices);

  const [open, setOpen] = useState(false);
  const [saveOpen, setSaveOpen] = useState(false);
  const [saveName, setSaveName] = useState('');
  const [renaming, setRenaming] = useState<ViewBookmark | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [saving, setSaving] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const existingNames = useMemo(
    () => new Set(bookmarks.map((b) => b.name)),
    [bookmarks]
  );

  // 挂载即从本地加载，使工具条角标能立即显示书签数量
  useEffect(() => {
    if (!loaded) {
      dispatch(initBookmarks());
    }
  }, [loaded, dispatch]);

  // 监听本地存储被其它页面清理或改写
  useEffect(() => {
    const checkStorageConsistency = () => {
      let raw: string | null = null;
      try {
        raw = window.localStorage.getItem(BOOKMARK_STORAGE_KEY);
      } catch {
        return;
      }
      if (raw === null) {
        if (allBookmarks.length > 0) {
          dispatch(markStorageCleared());
        }
        return;
      }
      // 外部（其它标签页）改写了书签文件，同步进来
      try {
        const result = loadBookmarks();
        const currentIds = new Set(allBookmarks.map((b) => b.id));
        const sameSet =
          result.bookmarks.length === allBookmarks.length &&
          result.bookmarks.every((b) => currentIds.has(b.id));
        if (!sameSet) {
          dispatch(replaceAll(result.bookmarks));
        }
      } catch {
        // 读取异常时不打扰用户，等下次显式操作再提示
      }
    };

    const handleStorage = (event: StorageEvent) => {
      if (event.key !== null && event.key !== BOOKMARK_STORAGE_KEY) return;
      // 同文档内的写入不会触发 storage 事件；能收到说明来自其它标签页
      if (event.newValue === null) {
        if (allBookmarks.length > 0) {
          dispatch(markStorageCleared());
        }
        return;
      }
      try {
        const result = loadBookmarks();
        dispatch(replaceAll(result.bookmarks));
      } catch (error) {
        message.warning(describeStorageError(error));
      }
    };

    window.addEventListener('storage', handleStorage);
    // 浏览器“清除站点数据”不会触发 storage 事件，回到页面时主动核对一次
    window.addEventListener('focus', checkStorageConsistency);
    document.addEventListener('visibilitychange', checkStorageConsistency);
    return () => {
      window.removeEventListener('storage', handleStorage);
      window.removeEventListener('focus', checkStorageConsistency);
      document.removeEventListener('visibilitychange', checkStorageConsistency);
    };
  }, [dispatch, allBookmarks]);

  const retryPersist = async () => {
    const resultAction = await dispatch(persistBookmarks());
    if (resultAction.payload) {
      message.success('已重新写入本地存储');
    } else {
      message.error('重试仍然失败，请检查浏览器存储设置或改用导出备份。');
    }
  };

  const retryLoad = () => {
    dispatch(initBookmarks());
  };

  const openSaveDialog = () => {
    if (!cameraBridge.capture()) {
      message.warning('三维画面尚未就绪，请稍后再保存书签。');
      return;
    }
    const base = `视图 ${bookmarks.length + 1}`;
    setSaveName(uniqueName(base, bookmarks.map((b) => b.name)));
    setSaveOpen(true);
  };

  const handleSave = async () => {
    const name = saveName.trim();
    if (!name) {
      message.warning('请填写书签名称');
      return;
    }
    if (bookmarks.some((b) => b.name === name)) {
      // 重名时提示并允许改名：给出一个不冲突的建议
      Modal.confirm({
        title: '书签名称已存在',
        content: `已存在名为“${name}”的书签，是否改用“${uniqueName(
          name,
          bookmarks.map((b) => b.name)
        )}”？也可以取消后自行改名。`,
        okText: '使用建议名称',
        cancelText: '返回修改',
        onOk: () => doSave(uniqueName(name, bookmarks.map((b) => b.name))),
      });
      return;
    }
    await doSave(name);
  };

  const doSave = async (name: string) => {
    const snapshot = cameraBridge.capture();
    if (!snapshot) {
      message.warning('三维画面尚未就绪，保存失败。');
      return;
    }
    setSaving(true);
    const slicesState = {
      inline: {
        visible: slices.inline.visible,
        opacity: slices.inline.opacity,
        index: slices.inline.index,
      },
      crossline: {
        visible: slices.crossline.visible,
        opacity: slices.crossline.opacity,
        index: slices.crossline.index,
      },
      depth: {
        visible: slices.depth.visible,
        opacity: slices.depth.opacity,
        index: slices.depth.index,
      },
    };
    try {
      const resultAction = await dispatch(
        addBookmark({
          seismicId,
          name,
          view: { camera: snapshot, slices: slicesState },
        })
      );
      if (addBookmark.fulfilled.match(resultAction)) {
        message.success(`书签“${name}”已保存到本地`);
        setSaveOpen(false);
      } else {
        const payload = resultAction.payload as
          | { duplicate?: boolean; storageError?: boolean }
          | undefined;
        if (payload?.duplicate) {
          message.warning('该名称已存在，请换一个名字。');
        } else {
          // 面板顶部会展示具体原因与“重试写入”按钮
          message.error(writeError?.message || '书签未能写入本地，可在面板中重试。');
        }
      }
    } finally {
      setSaving(false);
    }
  };

  const handleApply = (bookmark: ViewBookmark) => {
    cameraBridge.requestRestore(bookmark.view.camera);
    dispatch(applyBookmarkSlices(bookmark.view.slices));
    message.success(`已切换到书签“${bookmark.name}”`);
    setOpen(false);
  };

  const handleDelete = (bookmark: ViewBookmark) => {
    Modal.confirm({
      title: '删除书签',
      content: `确定删除书签“${bookmark.name}”吗？仅删除这一条，其它书签不受影响。`,
      okText: '删除',
      okButtonProps: { danger: true },
      cancelText: '取消',
      onOk: async () => {
        const resultAction = await dispatch(deleteBookmark({ id: bookmark.id, seismicId }));
        if (deleteBookmark.fulfilled.match(resultAction)) {
          message.success('书签已删除');
        } else {
          message.error(writeError?.message || '删除未能写入本地，可在面板中重试。');
        }
      },
    });
  };

  const openRename = (bookmark: ViewBookmark) => {
    setRenaming(bookmark);
    setRenameValue(bookmark.name);
  };

  const handleRename = async () => {
    if (!renaming) return;
    const name = renameValue.trim();
    if (!name) {
      message.warning('名称不能为空');
      return;
    }
    if (
      bookmarks.some((b) => b.name === name && b.id !== renaming.id)
    ) {
      message.warning(`名称“${name}”已被其它书签使用，请换一个名字。`);
      return;
    }
    const resultAction = await dispatch(
      renameBookmark({ id: renaming.id, seismicId, name })
    );
    if (renameBookmark.fulfilled.match(resultAction)) {
      message.success('书签已重命名');
      setRenaming(null);
    } else {
      const payload = resultAction.payload as
        | { duplicate?: boolean; notFound?: boolean; storageError?: boolean }
        | undefined;
      if (payload?.storageError) {
        message.error(writeError?.message || '重命名未能写入本地，可在面板中重试。');
      }
    }
  };

  const handleExportAll = () => {
    if (allBookmarks.length === 0) {
      message.info('还没有任何书签可导出。');
      return;
    }
    try {
      downloadBookmarkFile(buildExportFile(allBookmarks));
      message.success(`已导出全部 ${allBookmarks.length} 条书签`);
    } catch (error) {
      message.error(describeStorageError(error));
    }
  };

  const handleImportClick = () => {
    fileInputRef.current?.click();
  };

  const handleImportFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    let text: string;
    try {
      text = await file.text();
    } catch {
      message.error('读取文件失败，请重试或更换文件。');
      return;
    }

    let imported;
    try {
      imported = parseImportFile(text);
    } catch (error) {
      message.error(error instanceof Error ? error.message : '导入文件无法识别。');
      return;
    }

    if (imported.bookmarks.length === 0) {
      message.warning('文件中没有可导入的有效书签。');
      return;
    }

    // 与现有书签、以及同批次条目之间去重，重名自动改名
    const usedNames = new Set(allBookmarks.map((b) => `${b.seismicId}::${b.name}`));
    const incoming: ViewBookmark[] = [];
    let renamedCount = 0;
    for (const raw of imported.bookmarks) {
      const key = `${raw.seismicId}::${raw.name}`;
      let name = raw.name;
      if (usedNames.has(key)) {
        let suffix = 2;
        while (usedNames.has(`${raw.seismicId}::${raw.name} ${suffix}`)) suffix += 1;
        name = `${raw.name} ${suffix}`;
        renamedCount += 1;
      }
      const bookmark: ViewBookmark = {
        ...raw,
        id: createBookmarkId(),
        name,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      usedNames.add(`${raw.seismicId}::${name}`);
      incoming.push(bookmark);
    }

    const resultAction = await dispatch(importBookmarks(incoming));
    if (importBookmarks.fulfilled.match(resultAction)) {
      const parts = [`成功导入 ${incoming.length} 条书签`];
      if (renamedCount > 0) parts.push(`${renamedCount} 条因重名已自动改名`);
      if (imported.invalidCount > 0)
        parts.push(`${imported.invalidCount} 条格式无效已跳过`);
      message.success(parts.join('，'));
    } else {
      // 已进入内存但本地写入失败，面板顶部给出原因与“重试写入”
      message.error(writeError?.message || '导入的书签未能写入本地，可在面板中重试。');
    }
  };

  const listContent = (
    <div style={{ width: 340, maxHeight: '60vh', display: 'flex', flexDirection: 'column' }}>
      {loadError && (
        <Alert
          type="error"
          showIcon
          style={{ marginBottom: 8 }}
          message="无法读取本地书签"
          description={
            <Space direction="vertical" size={4}>
              <span>{loadError.message}</span>
              <Button size="small" icon={<ReloadOutlined />} onClick={retryLoad}>
                重试读取
              </Button>
            </Space>
          }
        />
      )}

      {storageCleared && !writeError && (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 8 }}
          message="本地书签已被清理"
          description={
            <Space direction="vertical" size={4}>
              <span>
                浏览器或其它页面清空了本地存储。内存中的书签仍保留着，可以立即写回本地。
              </span>
              <Button size="small" type="primary" icon={<SaveOutlined />} onClick={retryPersist}>
                重新保存到本地
              </Button>
            </Space>
          }
        />
      )}

      {writeError && (
        <Alert
          type="error"
          showIcon
          style={{ marginBottom: 8 }}
          message="书签写入本地失败"
          description={
            <Space direction="vertical" size={4}>
              <span>{writeError.message}</span>
              <Button size="small" type="primary" icon={<ReloadOutlined />} onClick={retryPersist}>
                重试写入
              </Button>
            </Space>
          }
        />
      )}

      {warning && !loadError && (
        <Alert
          type="warning"
          showIcon
          closable
          style={{ marginBottom: 8 }}
          message="读取本地数据时发现问题"
          description={warning}
          onClose={() => dispatch(clearWarning())}
        />
      )}

      <Space style={{ marginBottom: 8, justifyContent: 'space-between', width: '100%' }}>
        <Button size="small" type="primary" icon={<CameraOutlined />} onClick={openSaveDialog}>
          保存当前视图
        </Button>
        <Space size={4}>
          <Tooltip title="从备份文件导入书签">
            <Button size="small" icon={<ImportOutlined />} onClick={handleImportClick} />
          </Tooltip>
          <Tooltip title="下载全部书签备份">
            <Button size="small" icon={<ExportOutlined />} onClick={handleExportAll} />
          </Tooltip>
        </Space>
      </Space>

      <input
        ref={fileInputRef}
        type="file"
        accept="application/json,.json"
        style={{ display: 'none' }}
        onChange={handleImportFile}
      />

      <div style={{ overflowY: 'auto', flex: 1 }}>
        {bookmarks.length === 0 ? (
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description={
              <Space direction="vertical" size={0}>
                <Text type="secondary">还没有视图书签</Text>
                <Text type="secondary" style={{ fontSize: 12 }}>
                  调整好旋转角度、缩放和切片后，点击“保存当前视图”，
                  下次进入即可按名称找回画面。
                </Text>
              </Space>
            }
            style={{ margin: '12px 0' }}
          />
        ) : (
          <List
            size="small"
            dataSource={bookmarks}
            renderItem={(bookmark) => {
              const activeSliceCount = Object.values(bookmark.view.slices).filter(
                (s) => s.visible
              ).length;
              return (
                <List.Item
                  actions={[
                    <Tooltip title="切换到此视图" key="apply">
                      <Button
                        size="small"
                        type="link"
                        icon={<StarOutlined />}
                        onClick={() => handleApply(bookmark)}
                      />
                    </Tooltip>,
                    <Tooltip title="重命名" key="rename">
                      <Button
                        size="small"
                        type="link"
                        icon={<EditOutlined />}
                        onClick={() => openRename(bookmark)}
                      />
                    </Tooltip>,
                    <Tooltip title="删除（仅此一条）" key="delete">
                      <Button
                        size="small"
                        type="link"
                        danger
                        icon={<DeleteOutlined />}
                        onClick={() => handleDelete(bookmark)}
                      />
                    </Tooltip>,
                  ]}
                >
                  <List.Item.Meta
                    title={
                      <span
                        onClick={() => handleApply(bookmark)}
                        style={{ cursor: 'pointer' }}
                      >
                        {bookmark.name}
                      </span>
                    }
                    description={
                      <Text type="secondary" style={{ fontSize: 12 }}>
                        缩放 {bookmark.view.camera.radius.toFixed(0)} · 启用切片 {activeSliceCount} 个
                      </Text>
                    }
                  />
                </List.Item>
              );
            }}
          />
        )}
      </div>
    </div>
  );

  return (
    <>
      <Popover
        title={
          <Space>
            <StarOutlined />
            <span>视图书签</span>
          </Space>
        }
        content={listContent}
        trigger="click"
        open={open}
        onOpenChange={setOpen}
        placement="bottomLeft"
      >
        <Tooltip title="视图书签">
          <Badge count={bookmarks.length} size="small" offset={[-4, 4]}>
            <Button icon={<StarOutlined />} />
          </Badge>
        </Tooltip>
      </Popover>

      <Modal
        title="保存视图书签"
        open={saveOpen}
        onOk={handleSave}
        confirmLoading={saving}
        onCancel={() => setSaveOpen(false)}
        okText="保存"
        cancelText="取消"
        destroyOnClose
      >
        <Space direction="vertical" size={8} style={{ width: '100%' }}>
          <Text type="secondary" style={{ fontSize: 12 }}>
            将保存当前的旋转角度、缩放程度，以及 Inline / Crossline / 深度切片的启用状态与不透明度。
          </Text>
          <Input
            autoFocus
            value={saveName}
            placeholder="书签名称"
            maxLength={50}
            showCount
            onChange={(event) => setSaveName(event.target.value)}
            onPressEnter={handleSave}
            status={existingNames.has(saveName.trim()) ? 'warning' : ''}
          />
          {existingNames.has(saveName.trim()) && (
            <Text type="warning" style={{ fontSize: 12 }}>
              名称已存在，保存时会提示你改名。
            </Text>
          )}
        </Space>
      </Modal>

      <Modal
        title="重命名书签"
        open={renaming !== null}
        onOk={handleRename}
        onCancel={() => setRenaming(null)}
        okText="确定"
        cancelText="取消"
        destroyOnClose
      >
        <Input
          autoFocus
          value={renameValue}
          maxLength={50}
          onChange={(event) => setRenameValue(event.target.value)}
          onPressEnter={handleRename}
        />
      </Modal>
    </>
  );
};

export default ViewBookmarks;
