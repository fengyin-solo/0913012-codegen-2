import React, { useRef, useEffect, useState, useCallback } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { OrbitControls, PerspectiveCamera } from '@react-three/drei';
import * as THREE from 'three';
import { useSelector, useDispatch } from 'react-redux';
import { SeismicData, CameraSnapshot } from '../types';
import { RootState, AppDispatch } from '../store';
import { addMeasurementPoint, setLastMeasurement } from '../store/slices/viewerSlice';
import { seismicAPI } from '../services/api';
import { cameraBridge } from '../services/cameraBridge';
import VolumeRenderer from './VolumeRenderer';
import SliceRenderer from './SliceRenderer';
import MeasurementOverlay from './MeasurementOverlay';

interface SeismicCanvasProps {
  seismicData: SeismicData;
  containerRef: React.RefObject<HTMLDivElement>;
}

/** 与 OrbitControls 协作所需的最小接口 */
interface ControllableOrbit {
  target: THREE.Vector3;
  update: () => void;
}

/**
 * 注册相机与 OrbitControls 到相机桥，使工具条书签可以
 * 读取当前旋转/缩放，并在切换书签时还原画面。
 */
const CameraBridge: React.FC<{ minDistance: number; maxDistance: number }> = ({
  minDistance,
  maxDistance,
}) => {
  const camera = useThree((state) => state.camera);
  const controlsRef = useRef<ControllableOrbit | null>(null);

  useEffect(() => {
    const unsubscribe = cameraBridge.onRestore((snapshot: CameraSnapshot) => {
      const controls = controlsRef.current;
      if (!controls) return;
      controls.target.set(...snapshot.target);
      const radius = THREE.MathUtils.clamp(snapshot.radius, minDistance, maxDistance);
      const spherical = new THREE.Spherical(radius, snapshot.phi, snapshot.theta);
      const offset = new THREE.Vector3().setFromSpherical(spherical);
      camera.position.copy(controls.target).add(offset);
      camera.updateProjectionMatrix();
      controls.update();
    });
    return () => {
      unsubscribe();
      cameraBridge.unregister(camera);
    };
  }, [camera, minDistance, maxDistance]);

  return (
    <OrbitControls
      makeDefault
      enableDamping
      dampingFactor={0.05}
      minDistance={minDistance}
      maxDistance={maxDistance}
      ref={(instance) => {
        // drei 的 ref 在挂载/卸载时回调，桥内只保留最小接口
        controlsRef.current = instance as unknown as ControllableOrbit | null;
        cameraBridge.register(camera, controlsRef.current);
      }}
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
      <CameraBridge minDistance={maxDim * 0.1} maxDistance={maxDim * 5} />
      <SceneSetup seismicData={seismicData} />
      <SeismicScene seismicData={seismicData} />
    </Canvas>
  );
};

export default SeismicCanvas;
