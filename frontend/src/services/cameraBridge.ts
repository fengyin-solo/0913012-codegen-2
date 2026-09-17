import * as THREE from 'three';
import { CameraSnapshot } from '../types';

/**
 * 相机桥：让 Canvas 外部的工具条能够读取/还原三维画面的
 * 旋转角度（theta/phi）、缩放程度（radius）与观察目标（target）。
 * Canvas 内的 CameraBridge 组件在挂载时注册当前相机与 OrbitControls。
 */

interface ControllableCamera {
  camera: THREE.Camera;
  controls: {
    target: THREE.Vector3;
    update: () => void;
  } | null;
}

let registered: ControllableCamera | null = null;
const restoreListeners = new Set<(snapshot: CameraSnapshot) => void>();

export const cameraBridge = {
  register(camera: THREE.Camera, controls: ControllableCamera['controls']): void {
    registered = { camera, controls };
  },

  unregister(camera: THREE.Camera): void {
    if (registered?.camera === camera) {
      registered = null;
    }
  },

  /** 读取当前画面；相机尚未就绪时返回 null */
  capture(): CameraSnapshot | null {
    if (!registered) return null;
    const { camera, controls } = registered;
    const target = controls ? controls.target.clone() : new THREE.Vector3(0, 0, 0);
    const offset = camera.position.clone().sub(target);
    const spherical = new THREE.Spherical().setFromVector3(offset);
    return {
      theta: spherical.theta,
      phi: spherical.phi,
      radius: spherical.radius,
      target: [target.x, target.y, target.z],
    };
  },

  /** 请求还原画面（由 Canvas 内的监听者实际执行） */
  requestRestore(snapshot: CameraSnapshot): void {
    restoreListeners.forEach((listener) => listener(snapshot));
  },

  onRestore(listener: (snapshot: CameraSnapshot) => void): () => void {
    restoreListeners.add(listener);
    return () => {
      restoreListeners.delete(listener);
    };
  },
};
