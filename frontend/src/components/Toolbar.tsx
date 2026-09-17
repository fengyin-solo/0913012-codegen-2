import React from 'react';
import { Button, Space, Tooltip, Radio, Divider } from 'antd';
import {
  RotateLeftOutlined,
  ZoomInOutlined,
  LineChartOutlined,
  EditOutlined,
  SelectOutlined,
  ReloadOutlined,
  HomeOutlined,
} from '@ant-design/icons';
import { useDispatch, useSelector } from 'react-redux';
import { setTool, setMeasurementType, resetViewer, clearMeasurementPoints } from '../store/slices/viewerSlice';
import { RootState, AppDispatch } from '../store';
import ViewBookmarks from './ViewBookmarks';

const Toolbar: React.FC = () => {
  const dispatch = useDispatch<AppDispatch>();
  const currentTool = useSelector((state: RootState) => state.viewer.tool);
  const measurementType = useSelector((state: RootState) => state.viewer.measurementType);
  const currentSeismic = useSelector((state: RootState) => state.seismic.currentSeismic);

  const handleReset = () => {
    dispatch(resetViewer());
  };

  const handleClearMeasurements = () => {
    dispatch(clearMeasurementPoints());
  };

  const tools = [
    { key: 'rotate', icon: <RotateLeftOutlined />, label: '旋转' },
    { key: 'pan', icon: <ZoomInOutlined />, label: '平移' },
    { key: 'select', icon: <SelectOutlined />, label: '选择' },
    { key: 'measure', icon: <LineChartOutlined />, label: '测量' },
    { key: 'annotate', icon: <EditOutlined />, label: '标注' },
  ];

  return (
    <div className="toolbar">
      <Space.Compact>
        {tools.map((tool) => (
          <Tooltip key={tool.key} title={tool.label}>
            <Button
              type={currentTool === tool.key ? 'primary' : 'default'}
              icon={tool.icon}
              onClick={() => dispatch(setTool(tool.key as any))}
            />
          </Tooltip>
        ))}
      </Space.Compact>

      {currentTool === 'measure' && (
        <Radio.Group
          value={measurementType}
          onChange={(e) => dispatch(setMeasurementType(e.target.value))}
          size="small"
          style={{ marginLeft: 8 }}
        >
          <Radio.Button value="distance">距离</Radio.Button>
          <Radio.Button value="area">面积</Radio.Button>
          <Radio.Button value="volume">体积</Radio.Button>
        </Radio.Group>
      )}

      <Space style={{ marginLeft: 8 }}>
        <Tooltip title="重置视图">
          <Button icon={<HomeOutlined />} onClick={handleReset} />
        </Tooltip>
        {currentTool === 'measure' && (
          <Tooltip title="清除测量点">
            <Button icon={<ReloadOutlined />} onClick={handleClearMeasurements} />
          </Tooltip>
        )}
        {currentSeismic && (
          <>
            <Divider type="vertical" />
            <ViewBookmarks seismicId={currentSeismic.id} />
          </>
        )}
      </Space>
    </div>
  );
};

export default Toolbar;
