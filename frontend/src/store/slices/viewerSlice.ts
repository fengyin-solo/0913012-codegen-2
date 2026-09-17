import { createSlice, PayloadAction } from '@reduxjs/toolkit';
import { SliceConfig, VolumeRenderingConfig, Point3D, MeasurementResult, BookmarkView } from '../../types';

interface PendingView {
  view: BookmarkView;
  nonce: number;
}

interface ViewerState {
  slices: {
    inline: SliceConfig;
    crossline: SliceConfig;
    depth: SliceConfig;
  };
  volumeRendering: VolumeRenderingConfig;
  tool: 'select' | 'pan' | 'rotate' | 'measure' | 'annotate';
  measurementType: 'distance' | 'area' | 'volume';
  measurementPoints: Point3D[];
  lastMeasurement: MeasurementResult | null;
  background: 'dark' | 'light';
  showAxes: boolean;
  showGrid: boolean;
  zoom: number;
  rotation: [number, number, number];
  cameraPosition: [number, number, number] | null;
  cameraTarget: [number, number, number] | null;
  pendingView: PendingView | null;
}

const initialState: ViewerState = {
  slices: {
    inline: {
      type: 'inline',
      index: 0,
      visible: false,
      opacity: 1.0,
      colormap: 'seismic',
      minValue: null,
      maxValue: null,
    },
    crossline: {
      type: 'crossline',
      index: 0,
      visible: false,
      opacity: 1.0,
      colormap: 'seismic',
      minValue: null,
      maxValue: null,
    },
    depth: {
      type: 'depth',
      index: 0,
      visible: false,
      opacity: 1.0,
      colormap: 'seismic',
      minValue: null,
      maxValue: null,
    },
  },
  volumeRendering: {
    enabled: false,
    quality: 1,
    sampleRate: 0.5,
    opacity: 0.5,
  },
  tool: 'rotate',
  measurementType: 'distance',
  measurementPoints: [],
  lastMeasurement: null,
  background: 'dark',
  showAxes: true,
  showGrid: true,
  zoom: 1,
  rotation: [0, 0, 0],
  cameraPosition: null,
  cameraTarget: null,
  pendingView: null,
};

const viewerSlice = createSlice({
  name: 'viewer',
  initialState,
  reducers: {
    setSliceVisible: (
      state,
      action: PayloadAction<{ sliceType: 'inline' | 'crossline' | 'depth'; visible: boolean }>
    ) => {
      state.slices[action.payload.sliceType].visible = action.payload.visible;
    },
    setSliceIndex: (
      state,
      action: PayloadAction<{ sliceType: 'inline' | 'crossline' | 'depth'; index: number }>
    ) => {
      state.slices[action.payload.sliceType].index = action.payload.index;
    },
    setSliceOpacity: (
      state,
      action: PayloadAction<{ sliceType: 'inline' | 'crossline' | 'depth'; opacity: number }>
    ) => {
      state.slices[action.payload.sliceType].opacity = action.payload.opacity;
    },
    setSliceColormap: (
      state,
      action: PayloadAction<{ sliceType: 'inline' | 'crossline' | 'depth'; colormap: string }>
    ) => {
      state.slices[action.payload.sliceType].colormap = action.payload.colormap;
    },
    setSliceValueRange: (
      state,
      action: PayloadAction<{
        sliceType: 'inline' | 'crossline' | 'depth';
        minValue: number | null;
        maxValue: number | null;
      }>
    ) => {
      state.slices[action.payload.sliceType].minValue = action.payload.minValue;
      state.slices[action.payload.sliceType].maxValue = action.payload.maxValue;
    },
    setVolumeRenderingEnabled: (state, action: PayloadAction<boolean>) => {
      state.volumeRendering.enabled = action.payload;
    },
    setVolumeRenderingQuality: (state, action: PayloadAction<number>) => {
      state.volumeRendering.quality = action.payload;
    },
    setVolumeRenderingOpacity: (state, action: PayloadAction<number>) => {
      state.volumeRendering.opacity = action.payload;
    },
    setTool: (state, action: PayloadAction<ViewerState['tool']>) => {
      state.tool = action.payload;
      state.measurementPoints = [];
    },
    setMeasurementType: (state, action: PayloadAction<ViewerState['measurementType']>) => {
      state.measurementType = action.payload;
      state.measurementPoints = [];
    },
    addMeasurementPoint: (state, action: PayloadAction<Point3D>) => {
      state.measurementPoints.push(action.payload);
    },
    clearMeasurementPoints: (state) => {
      state.measurementPoints = [];
    },
    setLastMeasurement: (state, action: PayloadAction<MeasurementResult | null>) => {
      state.lastMeasurement = action.payload;
    },
    setBackground: (state, action: PayloadAction<'dark' | 'light'>) => {
      state.background = action.payload;
    },
    setShowAxes: (state, action: PayloadAction<boolean>) => {
      state.showAxes = action.payload;
    },
    setShowGrid: (state, action: PayloadAction<boolean>) => {
      state.showGrid = action.payload;
    },
    setZoom: (state, action: PayloadAction<number>) => {
      state.zoom = action.payload;
    },
    setRotation: (state, action: PayloadAction<[number, number, number]>) => {
      state.rotation = action.payload;
    },
    setCameraPose: (
      state,
      action: PayloadAction<{ position: [number, number, number]; target: [number, number, number] }>
    ) => {
      state.cameraPosition = action.payload.position;
      state.cameraTarget = action.payload.target;
    },
    resetCameraPose: (state) => {
      state.cameraPosition = null;
      state.cameraTarget = null;
      state.pendingView = null;
    },
    applyBookmarkView: (state, action: PayloadAction<BookmarkView>) => {      (['inline', 'crossline', 'depth'] as const).forEach((sliceType) => {
        const saved = action.payload.slices[sliceType];
        if (saved) {
          state.slices[sliceType].visible = saved.visible;
          state.slices[sliceType].opacity = saved.opacity;
        }
      });
      state.cameraPosition = [...action.payload.cameraPosition] as [number, number, number];
      state.cameraTarget = [...action.payload.cameraTarget] as [number, number, number];
      state.pendingView = {
        view: action.payload,
        nonce: (state.pendingView?.nonce ?? 0) + 1,
      };
    },
    resetViewer: (state) => {
      // 重置视图只还原视图配置与工具状态；相机姿态由相机自身管理，保持原样以免书签状态失效。
      state.slices.inline = { ...initialState.slices.inline };
      state.slices.crossline = { ...initialState.slices.crossline };
      state.slices.depth = { ...initialState.slices.depth };
      state.volumeRendering = { ...initialState.volumeRendering };
      state.tool = initialState.tool;
      state.measurementType = initialState.measurementType;
      state.measurementPoints = [];
      state.lastMeasurement = null;
      state.background = initialState.background;
      state.showAxes = initialState.showAxes;
      state.showGrid = initialState.showGrid;
      state.zoom = initialState.zoom;
      state.rotation = [...initialState.rotation] as [number, number, number];
    },
  },
});

export const {
  setSliceVisible,
  setSliceIndex,
  setSliceOpacity,
  setSliceColormap,
  setSliceValueRange,
  setVolumeRenderingEnabled,
  setVolumeRenderingQuality,
  setVolumeRenderingOpacity,
  setTool,
  setMeasurementType,
  addMeasurementPoint,
  clearMeasurementPoints,
  setLastMeasurement,
  setBackground,
  setShowAxes,
  setShowGrid,
  setZoom,
  setRotation,
  setCameraPose,
  resetCameraPose,
  applyBookmarkView,
  resetViewer,
} = viewerSlice.actions;
export default viewerSlice.reducer;
