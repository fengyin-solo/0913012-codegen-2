import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Button,
  Dropdown,
  Empty,
  Input,
  Modal,
  Popconfirm,
  Space,
  Tag,
  Tooltip,
  Alert,
  message,
} from 'antd';
import type { MenuProps } from 'antd';
import {
  StarOutlined,
  CameraOutlined,
  DeleteOutlined,
  EditOutlined,
  ExportOutlined,
  ImportOutlined,
  ReloadOutlined,
} from '@ant-design/icons';
import { useDispatch, useSelector } from 'react-redux';
import { RootState, AppDispatch } from '../store';
import {
  loadBookmarks,
  addBookmark,
  renameBookmark,
  deleteBookmark,
  importBookmarks,
  retryLastAction,
  clearBookmarkError,
  clearImportResult,
} from '../store/slices/bookmarkSlice';
import { applyBookmarkView } from '../store/slices/viewerSlice';
import {
  loadAllBookmarks,
  buildExportFile,
  parseImportFile,
} from '../services/bookmarkStorage';
import { BookmarkImportStrategy, BookmarkExportFile, SliceTypeName } from '../types';

const SLICE_TYPES: SliceTypeName[] = ['inline', 'crossline', 'depth'];

interface BookmarkMenuProps {
  seismicId: number;
  seismicName?: string;
}

const BookmarkMenu: React.FC<BookmarkMenuProps> = ({ seismicId, seismicName }) => {
  const dispatch = useDispatch<AppDispatch>();
  const { bookmarks, loading, error, errorContext, lastImport } = useSelector(
    (state: RootState) => state.bookmarks
  );
  const cameraPosition = useSelector((state: RootState) => state.viewer.cameraPosition);
  const cameraTarget = useSelector((state: RootState) => state.viewer.cameraTarget);
  const slices = useSelector((state: RootState) => state.viewer.slices);

  const [open, setOpen] = useState(false);

  // 保存弹窗
  const [saveOpen, setSaveOpen] = useState(false);
  const [saveName, setSaveName] = useState('');

  // 改名弹窗
  const [renameTarget, setRenameTarget] = useState<{ id: string; name: string } | null>(null);
  const [renameValue, setRenameValue] = useState('');

  // 导入冲突处理
  const [importData, setImportData] = useState<{
    datasets: BookmarkExportFile['datasets'];
    total: number;
    skipped: number;
    conflictIds: number;
  } | null>(null);
  const [importStrategy, setImportStrategy] = useState<BookmarkImportStrategy>('rename');

  const fileInputRef = useRef<HTMLInputElement>(null);

  // 进入/切换数据体时加载书签
  useEffect(() => {
    dispatch(loadBookmarks(seismicId));
  }, [dispatch, seismicId]);

  useEffect(() => {
    if (lastImport) {
      const parts = [`已导入 ${lastImport.imported} 个书签`];
      if (lastImport.conflicts > 0) parts.push(`处理冲突 ${lastImport.conflicts} 个`);
      if (lastImport.skipped > 0) parts.push(`跳过无效条目 ${lastImport.skipped} 个`);
      message.success(parts.join('，'));
      dispatch(clearImportResult());
    }
  }, [lastImport, dispatch]);

  const currentView = useMemo(() => {
    if (!cameraPosition || !cameraTarget) return null;
    return {
      cameraPosition: [...cameraPosition] as [number, number, number],
      cameraTarget: [...cameraTarget] as [number, number, number],
      slices: SLICE_TYPES.reduce(
        (acc, t) => {
          acc[t] = { visible: slices[t].visible, opacity: slices[t].opacity };
          return acc;
        },
        {} as Record<SliceTypeName, { visible: boolean; opacity: number }>
      ),
    };
  }, [cameraPosition, cameraTarget, slices]);

  const findByName = (name: string) =>
    bookmarks.find((b) => b.name.trim() === name.trim());

  // ---------- 保存 ----------
  const openSave = () => {
    if (!currentView) {
      message.warning('三维画面尚未初始化完成，请稍后再试。');
      return;
    }
    setSaveName('');
    setSaveOpen(true);
  };

  // 以新名称保存；重名时不写入，由弹窗内的提示与"覆盖"按钮处理
  const handleSaveAsNew = () => {
    if (!currentView) return;
    const name = saveName.trim();
    if (!name) {
      message.warning('请输入书签名称');
      return;
    }
    if (findByName(name)) {
      message.warning(`已存在名为「${name}」的书签，请改名或选择覆盖`);
      return;
    }
    dispatch(addBookmark({ seismicId, seismicName, name, view: currentView }))
      .unwrap()
      .then(() => {
        message.success(`已保存书签「${name}」`);
        setSaveOpen(false);
      })
      .catch(() => {
        /* 错误原因由下拉面板中的提示展示，可重试 */
      });
  };

  // 覆盖已有书签：保留其 id/createdAt，仅替换画面与更新时间
  const handleOverwrite = async () => {
    if (!currentView) return;
    const name = saveName.trim();
    const existing = findByName(name);
    if (!existing) {
      handleSaveAsNew();
      return;
    }
    const { saveBookmarkObject } = await import('../store/slices/bookmarkSlice');
    dispatch(
      saveBookmarkObject({
        ...existing,
        seismicName,
        view: currentView,
        updatedAt: new Date().toISOString(),
      })
    )
      .unwrap()
      .then(() => {
        message.success(`已覆盖书签「${name}」`);
        setSaveOpen(false);
      })
      .catch(() => {
        /* 见错误提示区 */
      });
  };

  // ---------- 应用 ----------
  const handleApply = (bookmarkId: string) => {
    const bm = bookmarks.find((b) => b.id === bookmarkId);
    if (!bm) return;
    dispatch(applyBookmarkView(bm.view));
    message.success(`已切换到书签「${bm.name}」`);
    setOpen(false);
  };

  // ---------- 改名 ----------
  const submitRename = () => {
    if (!renameTarget) return;
    const name = renameValue.trim();
    if (!name) {
      message.warning('请输入书签名称');
      return;
    }
    const dup = findByName(name);
    if (dup && dup.id !== renameTarget.id) {
      message.warning(`已存在名为「${name}」的书签，请换一个名称`);
      return;
    }
    dispatch(renameBookmark({ seismicId, bookmarkId: renameTarget.id, name }))
      .unwrap()
      .then(() => {
        message.success('已改名');
        setRenameTarget(null);
      })
      .catch(() => {
        /* 见错误提示区 */
      });
  };

  // ---------- 删除 ----------
  const handleDelete = (bookmarkId: string) => {
    dispatch(deleteBookmark({ seismicId, bookmarkId }))
      .unwrap()
      .then(() => message.success('已删除该书签'))
      .catch(() => {
        /* 见错误提示区 */
      });
  };

  // ---------- 导出全部 ----------
  const handleExport = () => {
    let all;
    try {
      all = loadAllBookmarks((id, e) => {
        message.warning(`数据体 ${id} 的书签数据异常，已跳过：${e.message}`);
      });
    } catch (e: any) {
      message.error(`读取本地书签失败：${e?.message ?? '未知错误'}`);
      return;
    }
    if (all.length === 0) {
      message.info('还没有任何书签可导出');
      return;
    }
    const fileData = buildExportFile(all);
    const blob = new Blob([JSON.stringify(fileData, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
    a.href = url;
    a.download = `view-bookmarks-${stamp}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  // ---------- 导入 ----------
  const openImportPicker = () => {
    fileInputRef.current?.click();
  };

  const handleImportFile = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const result = parseImportFile(String(reader.result));
        // 统计冲突（同名或同 id）
        let conflictIds = 0;
        Object.entries(result.datasets).forEach(([idKey, group]) => {
          const isCurrent = Number(idKey) === seismicId;
          const existing = isCurrent ? bookmarks : [];
          const ids = new Set(existing.map((b) => b.id));
          const names = new Set(existing.map((b) => b.name.trim()));
          if (
            group.bookmarks.some((b) => ids.has(b.id) || names.has(b.name.trim()))
          ) {
            conflictIds++;
          }
        });
        // 非当前数据体无法在内存中比对冲突，导入时仍会在服务层检测；这里只提示当前数据体
        setImportData({
          datasets: result.datasets,
          total: result.total,
          skipped: result.skipped,
          conflictIds,
        });
        setImportStrategy('rename');
      } catch (e: any) {
        message.error(e?.message ?? '导入文件解析失败');
      }
    };
    reader.onerror = () => message.error('读取文件失败，请重试');
    reader.readAsText(file);
  };

  const confirmImport = () => {
    if (!importData) return;
    dispatch(
      importBookmarks({
        datasets: importData.datasets,
        strategy: importStrategy,
        skipped: importData.skipped,
      })
    )
      .unwrap()
      .then(() => {
        setImportData(null);
        setOpen(false);
      })
      .catch(() => {
        /* 见错误提示区，导入数据已保留可重试 */
      });
  };

  // ---------- 下拉面板 ----------
  const dropdownContent = (
    <div
      style={{
        background: '#fff',
        borderRadius: 8,
        boxShadow: '0 6px 16px rgba(0,0,0,0.12)',
        padding: 12,
        width: 320,
      }}
    >
      <Space style={{ marginBottom: 8, width: '100%', justifyContent: 'space-between' }}>
        <strong>视图书签</strong>
        <Space size={4}>
          <Tooltip title="导入书签备份">
            <Button size="small" type="text" icon={<ImportOutlined />} onClick={openImportPicker} />
          </Tooltip>
          <Tooltip title="导出全部书签为备份文件">
            <Button size="small" type="text" icon={<ExportOutlined />} onClick={handleExport} />
          </Tooltip>
          <Tooltip title="刷新列表">
            <Button
              size="small"
              type="text"
              icon={<ReloadOutlined spin={loading} />}
              onClick={() => dispatch(loadBookmarks(seismicId))}
            />
          </Tooltip>
        </Space>
      </Space>

      <Button
        type="primary"
        block
        icon={<StarOutlined />}
        onClick={openSave}
        style={{ marginBottom: 8 }}
      >
        保存当前画面为书签
      </Button>

      {error && (
        <Alert
          type="error"
          showIcon
          style={{ marginBottom: 8 }}
          message={`${errorContext ? `${errorContext}失败：` : ''}${error.message}`}
          action={
            <Space direction="vertical" size={0}>
              <Button
                size="small"
                type="link"
                icon={<ReloadOutlined />}
                onClick={() => dispatch(retryLastAction())}
              >
                重试
              </Button>
              <Button size="small" type="link" onClick={() => dispatch(clearBookmarkError())}>
                忽略
              </Button>
            </Space>
          }
        />
      )}

      <div style={{ maxHeight: 320, overflowY: 'auto' }}>
        {bookmarks.length === 0 ? (
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description={
              error ? (
                <span style={{ fontSize: 12 }}>书签列表加载失败，请按上方提示重试</span>
              ) : (
                <span style={{ fontSize: 12 }}>
                  暂无书签。调整好旋转角度、缩放与切片后，
                  点击上方「保存当前画面为书签」，
                  下次回来即可按名称一键找回。
                </span>
              )
            }
          />
        ) : (
          bookmarks.map((bm) => (
            <div
              key={bm.id}
              style={{
                display: 'flex',
                alignItems: 'center',
                padding: '6px 8px',
                borderRadius: 6,
                transition: 'background 0.2s',
              }}
              className="bookmark-item"
            >
              <CameraOutlined style={{ marginRight: 8, color: '#1677ff' }} />
              <Tooltip title="点击恢复该书签画面">
                <a
                  onClick={() => handleApply(bm.id)}
                  style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                >
                  {bm.name}
                </a>
              </Tooltip>
              <Space size={0}>
                <Tooltip title="改名">
                  <Button
                    size="small"
                    type="text"
                    icon={<EditOutlined />}
                    onClick={() => {
                      setRenameTarget({ id: bm.id, name: bm.name });
                      setRenameValue(bm.name);
                    }}
                  />
                </Tooltip>
                <Popconfirm
                  title="删除书签"
                  description={`确定删除「${bm.name}」吗？仅删除这一条，其他书签不受影响。`}
                  okText="删除"
                  okButtonProps={{ danger: true }}
                  cancelText="取消"
                  onConfirm={() => handleDelete(bm.id)}
                >
                  <Tooltip title="删除">
                    <Button size="small" type="text" danger icon={<DeleteOutlined />} />
                  </Tooltip>
                </Popconfirm>
              </Space>
            </div>
          ))
        )}
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept="application/json,.json"
        style={{ display: 'none' }}
        onChange={handleImportFile}
      />
    </div>
  );

  const dropdownProps: MenuProps = { items: [] };

  const saveDuplicate = saveName.trim() ? findByName(saveName) : undefined;

  return (
    <>
      <Dropdown
        open={open}
        onOpenChange={setOpen}
        trigger={['click']}
        menu={dropdownProps}
        dropdownRender={() => dropdownContent}
      >
        <Button icon={<StarOutlined />}>
          视图书签
          {bookmarks.length > 0 && <Tag style={{ marginInlineStart: 6 }}>{bookmarks.length}</Tag>}
        </Button>
      </Dropdown>

      {/* 保存弹窗（含重名提示与改名/覆盖） */}
      <Modal
        title="保存视图书签"
        open={saveOpen}
        onCancel={() => setSaveOpen(false)}
        footer={
          <Space>
            <Button onClick={() => setSaveOpen(false)}>取消</Button>
            <Button
              type="primary"
              onClick={handleSaveAsNew}
              disabled={!saveName.trim() || !!saveDuplicate}
            >
              保存
            </Button>
            {saveDuplicate && (
              <Button danger onClick={handleOverwrite}>
                覆盖「{saveDuplicate.name}」
              </Button>
            )}
          </Space>
        }
      >
        <div style={{ marginBottom: 8, color: 'rgba(0,0,0,0.65)' }}>
          将保存当前的旋转角度、缩放程度，以及三个切片的启用状态与不透明度。
          {seismicName && (
            <span style={{ display: 'block', marginTop: 4 }}>
              所属数据体：<Tag>{seismicName}</Tag>
            </span>
          )}
        </div>
        <Input
          autoFocus
          placeholder="请输入书签名称，如：沿层切片视角"
          value={saveName}
          maxLength={50}
          showCount
          onChange={(e) => setSaveName(e.target.value)}
          onPressEnter={() => {
            if (!saveDuplicate) handleSaveAsNew();
          }}
        />
        {saveDuplicate && (
          <Alert
            style={{ marginTop: 8 }}
            type="warning"
            showIcon
            message={`名称「${saveName.trim()}」已存在`}
            description="可以修改名称后重新保存，或用当前画面覆盖原书签。"
          />
        )}
      </Modal>

      {/* 改名弹窗 */}
      <Modal
        title="书签改名"
        open={!!renameTarget}
        onCancel={() => setRenameTarget(null)}
        onOk={submitRename}
        okText="确定"
        cancelText="取消"
      >
        <Input
          autoFocus
          value={renameValue}
          maxLength={50}
          onChange={(e) => setRenameValue(e.target.value)}
          onPressEnter={submitRename}
        />
      </Modal>

      {/* 导入冲突处理弹窗 */}
      <Modal
        title="导入书签备份"
        open={!!importData}
        onCancel={() => setImportData(null)}
        onOk={confirmImport}
        okText="开始导入"
        cancelText="取消"
        confirmLoading={loading}
      >
        {importData && (
          <>
            <p>
              备份文件中共有 <strong>{importData.total}</strong> 个书签
              {importData.skipped > 0 && (
                <span>（{importData.skipped} 个无效条目将跳过）</span>
              )}
              ，将按数据体分别导入到本地。
            </p>
            {importData.conflictIds > 0 && (
              <Alert
                type="warning"
                showIcon
                style={{ marginBottom: 12 }}
                message="检测到同名或同标识的书签"
                description="请选择遇到重名/重复时的处理方式："
              />
            )}
            <Space direction="vertical">
              <label>
                <input
                  type="radio"
                  checked={importStrategy === 'rename'}
                  onChange={() => setImportStrategy('rename')}
                />{' '}
                自动改名后保留两者（推荐，书签名后追加"导入"）
              </label>
              <label>
                <input
                  type="radio"
                  checked={importStrategy === 'skip'}
                  onChange={() => setImportStrategy('skip')}
                />{' '}
                跳过重复的书签，保留本地现有版本
              </label>
              <label>
                <input
                  type="radio"
                  checked={importStrategy === 'overwrite'}
                  onChange={() => setImportStrategy('overwrite')}
                />{' '}
                用备份文件中的版本覆盖本地书签
              </label>
            </Space>
          </>
        )}
      </Modal>
    </>
  );
};

export default BookmarkMenu;
