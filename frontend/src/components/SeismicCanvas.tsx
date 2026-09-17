import React, { useRef, useEffect, useState, useCallback } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { OrbitControls, PerspectiveCamera } from '@react-three/drei';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import * as THREE from 'three';
import { useSelector, useDispatch } from 'react-redux';
import { SeismicData, BookmarkView } from '../types';
import { RootState, AppDispatch } from '../store';
import { addMeasurementPoint, setLastMeasurement, setCameraPose, resetCameraPose } from '../store/slices/viewerSlice';
import { seismicAPI } from '../services/api';
import VolumeRenderer from './VolumeRenderer';
import SliceRenderer from './SliceRenderer';
import MeasurementOverlay from './MeasurementOverlay';

interface SeismicCanvasProps {
  seismicData: SeismicData;
  containerRef: React.RefObject<HTMLDivElement>;
}

/**
 * 相机控制器：
 * - 用户通过 OrbitControls 旋转/缩放/平移时，把相机位置与目标点同步到 Redux，
 *   书签保存的"旋转角度、缩放程度"即由相机相对目标的位置表达；
 * - pendingView（应用书签）变化时，在约 400ms 内平滑过渡到书签保存的姿态。
 */
const CameraRig: React.FC<{ maxDim: number }> = ({ maxDim }) => {
  const dispatch = useDispatch<AppDispatch>();
  const controlsRef = useRef<OrbitControlsImpl>(null);
  const { camera } = useThree();

  const pendingView = useSelector((state: RootState) => state.viewer.pendingView);

  // 当前进行中的过渡动画
  const tweenRef = useRef<{
    startPos: THREE.Vector3;
    startTarget: THREE.Vector3;
    endPos: THREE.Vector3;
    endTarget: THREE.Vector3;
    t: number;
  } | null>(null);

  // 上一次同步到 Redux 的姿态，避免高频重复派发
  const lastSyncedRef = useRef<{ px: number; py: number; pz: number; tx: number; ty: number; tz: number } | null>(null);
  const syncScheduledRef = useRef(false);
  const lastNonceRef = useRef(0);

  const syncPose = useCallback(() => {
    syncScheduledRef.current = false;
    const controls = controlsRef.current;
    if (!controls) return;
    const p = camera.position;
    const tgt = controls.target;
    const last = lastSyncedRef.current;
    const EPS = 1e-6;
    if (
      last &&
      Math.abs(last.px - p.x) < EPS &&
      Math.abs(last.py - p.y) < EPS &&
      Math.abs(last.pz - p.z) < EPS &&
      Math.abs(last.tx - tgt.x) < EPS &&
      Math.abs(last.ty - tgt.y) < EPS &&
      Math.abs(last.tz - tgt.z) < EPS
    ) {
      return;
    }
    lastSyncedRef.current = { px: p.x, py: p.y, pz: p.z, tx: tgt.x, ty: tgt.y, tz: tgt.z };
    dispatch(
      setCameraPose({
        position: [p.x, p.y, p.z],
        target: [tgt.x, tgt.y, tgt.z],
      })
    );
  }, [camera, dispatch]);

  const scheduleSync = useCallback(() => {
    if (syncScheduledRef.current) return;
    syncScheduledRef.current = true;
    requestAnimationFrame(syncPose);
  }, [syncPose]);

  // 初始化默认相机姿态到 Redux（只做一次）
  useEffect(() => {
    const controls = controlsRef.current;
    if (!controls) return;
    controls.target.set(0, 0, 0);
    controls.update();
    scheduleSync();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 切换数据体（默认视距随 maxDim 变化）时相机归位，并清掉书签姿态引用
  const maxDimRef = useRef(maxDim);
  useEffect(() => {
    if (maxDimRef.current === maxDim) return;
    maxDimRef.current = maxDim;
    const controls = controlsRef.current;
    if (!controls) return;
    controls.target.set(0, 0, 0);
    camera.position.set(maxDim * 1.5, maxDim * 0.8, maxDim * 1.5);
    controls.update();
    lastSyncedRef.current = null;
    lastNonceRef.current = 0;
    tweenRef.current = null;
    dispatch(resetCameraPose());
    scheduleSync();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [maxDim]);

  // 应用书签：启动平滑过渡
  useEffect(() => {
    if (!pendingView || pendingView.nonce === lastNonceRef.current) return;
    lastNonceRef.current = pendingView.nonce;
    const controls = controlsRef.current;
    if (!controls) return;

    const v: BookmarkView = pendingView.view;
    tweenRef.current = {
      startPos: camera.position.clone(),
      startTarget: controls.target.clone(),
      endPos: new THREE.Vector3(...v.cameraPosition),
      endTarget: new THREE.Vector3(...v.cameraTarget),
      t: 0,
    };
  }, [pendingView, camera]);

  // 用户开始手动操作时取消过渡
  const handleUserStart = useCallback(() => {
    tweenRef.current = null;
  }, []);

  useFrame((_, delta) => {
    const controls = controlsRef.current;
    if (!controls) return;

    const tween = tweenRef.current;
    if (tween) {
      tween.t = Math.min(1, tween.t + delta / 0.4);
      const k = tween.t < 0.5 ? 2 * tween.t * tween.t : 1 - Math.pow(-2 * tween.t + 2, 2) / 2;
      camera.position.lerpVectors(tween.startPos, tween.endPos, k);
      controls.target.lerpVectors(tween.startTarget, tween.endTarget, k);
      if (tween.t >= 1) {
        tweenRef.current = null;
      }
      controls.update();
      scheduleSync();
    }
  });

  return (
    <OrbitControls
      ref={controlsRef}
      enableDamping
      dampingFactor={0.05}
      minDistance={maxDim * 0.1}
      maxDistance={maxDim * 5}
      onStart={handleUserStart}
      onChange={scheduleSync}
    />
  );
};

const SceneSetup: React.FC<{ seismicData: SeismicData }> = ({ seismicData }) => {
  const background = useSelector((state: RootState) => state.viewer.background);
  const showAxes = useSelector((state: RootState) => state.viewer.showAxes);
  const showGrid = useSelector((state: RootState) => state.viewer.showGrid);

  const width = (seismicData.num_crosslines || 100) * 10;
  const height = (seismicData.num_depths || 100) * 10;
  const depth = (seismicData.num_inlines || 100) * 10;

  const bgColor = background === 'dark' ? '#0a0a0a' : '#f5f5f5';

  return (
    <>
      <color attach="background" args={[bgColor]} />
      <ambientLight intensity={0.6} />
      <directionalLight position={[100, 100, 50]} intensity={1} />
      <directionalLight position={[-100, -100, -50]} intensity={0.3} />

      {showAxes && (
        <axesHelper args={[Math.max(width, height, depth) * 0.6]} />
      )}

      {showGrid && (
        <gridHelper args={[Math.max(width, depth), 20, '#888888', '#444444']} position={[0, -height / 2, 0]} />
      )}
    </>
  );
};

const Raycaster: React.FC<{
  seismicData: SeismicData;
  onPointClick: (point: THREE.Vector3) => void;
}> = ({ seismicData, onPointClick }) => {
  const { raycaster, mouse, camera } = useThree();
  const tool = useSelector((state: RootState) => state.viewer.tool);
  const planeRef = useRef<THREE.Mesh>(null);

  const width = (seismicData.num_crosslines || 100) * 10;
  const height = (seismicData.num_depths || 100) * 10;
  const depth = (seismicData.num_inlines || 100) * 10;

  useEffect(() => {
    const handleClick = (event: MouseEvent) => {
      if (tool !== 'measure' || !planeRef.current) return;

      const rect = (event.target as HTMLCanvasElement).getBoundingClientRect();
      mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

      raycaster.setFromCamera(mouse, camera);
      const intersects = raycaster.intersectObject(planeRef.current);

      if (intersects.length > 0) {
        onPointClick(intersects[0].point.clone());
      }
    };

    window.addEventListener('click', handleClick);
    return () => window.removeEventListener('click', handleClick);
  }, [raycaster, mouse, camera, tool, onPointClick]);

  return (
    <mesh ref={planeRef} position={[0, 0, 0]} visible={false}>
      <planeGeometry args={[width * 2, height * 2]} />
      <meshBasicMaterial transparent opacity={0} />
    </mesh>
  );
};

const SeismicScene: React.FC<{ seismicData: SeismicData }> = ({ seismicData }) => {
  const dispatch = useDispatch<AppDispatch>();
  const volumeRendering = useSelector((state: RootState) => state.viewer.volumeRendering);
  const measurementPoints = useSelector((state: RootState) => state.viewer.measurementPoints);
  const measurementType = useSelector((state: RootState) => state.viewer.measurementType);

  const handlePointClick = useCallback(
    async (point: THREE.Vector3) => {
      const point3D = { x: point.x, y: point.y, z: point.z };
      dispatch(addMeasurementPoint(point3D));

      const newPoints = [...measurementPoints, point3D];
      
      let requiredPoints = 2;
      if (measurementType === 'area') requiredPoints = 3;
      if (measurementType === 'volume') requiredPoints = 4;

      if (newPoints.length >= requiredPoints) {
        try {
          const response = await seismicAPI.measure({
            points: newPoints,
            measurement_type: measurementType,
          });
          dispatch(setLastMeasurement(response.data));
        } catch (error) {
          console.error('Measurement failed:', error);
        }
      }
    },
    [dispatch, measurementPoints, measurementType]
  );

  const width = (seismicData.num_crosslines || 100) * 10;
  const height = (seismicData.num_depths || 100) * 10;
  const depth = (seismicData.num_inlines || 100) * 10;

  return (
    <>
      <group position={[-width / 2, -height / 2, -depth / 2]}>
        {volumeRendering.enabled && (
          <VolumeRenderer
            seismicData={seismicData}
            config={volumeRendering}
          />
        )}

        <SliceRenderer seismicData={seismicData} />

        <MeasurementOverlay />

        <mesh position={[width / 2, height / 2, depth / 2]}>
          <boxGeometry args={[width, height, depth]} />
          <meshBasicMaterial color="#ffffff" wireframe transparent opacity={0.1} />
        </mesh>
      </group>

      <Raycaster seismicData={seismicData} onPointClick={handlePointClick} />
    </>
  );
};

const SeismicCanvas: React.FC<SeismicCanvasProps> = ({ seismicData, containerRef }) => {
  const width = (seismicData.num_crosslines || 100) * 10;
  const height = (seismicData.num_depths || 100) * 10;
  const depth = (seismicData.num_inlines || 100) * 10;
  const maxDim = Math.max(width, height, depth);

  return (
    <Canvas
      style={{ width: '100%', height: '100%' }}
      gl={{ antialias: true, alpha: false }}
      dpr={[1, 2]}
    >
      <PerspectiveCamera
        makeDefault
        position={[maxDim * 1.5, maxDim * 0.8, maxDim * 1.5]}
        fov={60}
        near={0.1}
        far={maxDim * 10}
      />
      <CameraRig maxDim={maxDim} />
      <SceneSetup seismicData={seismicData} />
      <SeismicScene seismicData={seismicData} />
    </Canvas>
  );
};

export default SeismicCanvas;
