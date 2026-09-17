export interface User {
  id: number;
  username: string;
  email: string;
  full_name: string | null;
  is_active: boolean;
  is_admin: boolean;
  created_at: string;
}

export interface Project {
  id: number;
  name: string;
  description: string | null;
  created_by: number;
  created_at: string;
  updated_at: string | null;
}

export interface ProjectMember {
  id: number;
  project_id: number;
  user_id: number;
  role: string;
  user?: User;
  created_at: string;
}

export interface SeismicDataDimensions {
  inline_start: number;
  inline_end: number;
  inline_step: number;
  crossline_start: number;
  crossline_end: number;
  crossline_step: number;
  depth_start: number;
  depth_end: number;
  depth_step: number;
  num_inlines: number;
  num_crosslines: number;
  num_depths: number;
}

export interface SeismicDataStats {
  min_value: number;
  max_value: number;
  mean_value: number;
  std_value: number;
}

export interface SeismicData {
  id: number;
  project_id: number;
  name: string;
  description: string | null;
  file_type: string;
  file_size: number | null;
  status: string;
  upload_progress: number;
  created_by: number;
  created_at: string;
  dimensions?: SeismicDataDimensions;
  statistics?: SeismicDataStats;
  inline_start?: number;
  inline_end?: number;
  inline_step?: number;
  crossline_start?: number;
  crossline_end?: number;
  crossline_step?: number;
  depth_start?: number;
  depth_end?: number;
  depth_step?: number;
  num_inlines?: number;
  num_crosslines?: number;
  num_depths?: number;
  min_value?: number;
  max_value?: number;
  mean_value?: number;
  std_value?: number;
}

export interface Annotation {
  id: number;
  seismic_data_id: number;
  owner_id: number;
  name: string | null;
  annotation_type: string;
  geometry: any;
  properties: any;
  created_at: string;
  updated_at: string | null;
}

export interface Well {
  id: number;
  project_id: number;
  name: string;
  uwi: string | null;
  x: number | null;
  y: number | null;
  kb_elevation: number | null;
  total_depth: number | null;
  created_at: string;
}

export interface Point3D {
  x: number;
  y: number;
  z: number;
}

export interface MeasurementResult {
  measurement_type: string;
  value: number;
  unit: string;
  points: Point3D[];
}

export interface SliceConfig {
  type: 'inline' | 'crossline' | 'depth';
  index: number;
  visible: boolean;
  opacity: number;
  colormap: string;
  minValue: number | null;
  maxValue: number | null;
}

export interface VolumeRenderingConfig {
  enabled: boolean;
  quality: number;
  sampleRate: number;
  opacity: number;
}

export interface ViewState {
  cameraPosition: [number, number, number];
  cameraTarget: [number, number, number];
}

/** 书签保存的切片类型 */
export type BookmarkSliceType = 'inline' | 'crossline' | 'depth';

/** 书签中记录的相机状态：旋转角度 + 缩放距离 + 观察目标 */
export interface CameraSnapshot {
  /** 方位角（绕竖直轴的旋转角度，弧度） */
  theta: number;
  /** 极角（与竖直轴的夹角，弧度） */
  phi: number;
  /** 相机到观察目标的距离，代表缩放程度 */
  radius: number;
  /** 观察目标（旋转中心） */
  target: [number, number, number];
}

/** 单个切片在书签中的状态：启用情况、透明度及所在索引 */
export interface BookmarkSliceState {
  visible: boolean;
  opacity: number;
  index: number;
}

/** 书签保存的画面内容 */
export interface BookmarkView {
  camera: CameraSnapshot;
  slices: Record<BookmarkSliceType, BookmarkSliceState>;
}

/** 视图书签 */
export interface ViewBookmark {
  id: string;
  /** 所属地震数据 */
  seismicId: number;
  name: string;
  view: BookmarkView;
  createdAt: number;
  updatedAt: number;
}

/** 书签导出文件结构 */
export interface ViewBookmarkFile {
  app: string;
  kind: 'seismic-view-bookmarks';
  version: number;
  exportedAt: number;
  bookmarks: ViewBookmark[];
}
