import * as THREE from 'three';

/** A mesh whose vertices (or instances) sit further than this from its own origin is given one of its own. */
const FAR = 400;

/**
 * Give everything under `root` that was built with course positions written straight into its vertices or its
 * instances an origin of its own, at the middle of what it draws. Nothing moves on the screen: the vertices (or the
 * instances) are moved by minus that middle and the object by plus it.
 *
 * Why: the graphics card works in single precision. A vertex twenty kilometres from its object's origin, drawn by a
 * camera also twenty kilometres out, is two large numbers subtracted on the card, and the answer shakes by millimetres
 * as the camera moves. An object's own position is applied on the CPU in double precision (`Stage.draw`), so moving the
 * large part of each vertex into it leaves the card with small numbers.
 *
 * Only build-time geometry is touched: a geometry shared by more than one object, one that is rewritten as it runs
 * (dynamic), skinned meshes, and anything already about its own origin are left as they are. Heights are never changed,
 * so code that reads a land mesh's heights back (`aboard/kayak.ts`, the stage's own height lookup) is unaffected.
 * @returns how many objects were given an origin of their own
 */
export function recentre(root: THREE.Object3D): number {
  const users = new Map<THREE.BufferGeometry, number>();
  root.traverse((o) => {
    const g = (o as THREE.Mesh).geometry as THREE.BufferGeometry | undefined;
    if (g) users.set(g, (users.get(g) ?? 0) + 1);
  });
  const centre = new THREE.Vector3();
  const shift = new THREE.Vector3();
  const m = new THREE.Matrix4();
  let moved = 0;
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    const g = mesh.geometry as THREE.BufferGeometry | undefined;
    if (!g || (o as THREE.SkinnedMesh).isSkinnedMesh) return;
    const inst = o as THREE.InstancedMesh;
    if (inst.isInstancedMesh) {
      // The instances' own places carry the distance: move them, not the shared shape.
      const n = inst.count;
      if (!n) return;
      centre.set(0, 0, 0);
      for (let i = 0; i < n; i++) {
        inst.getMatrixAt(i, m);
        centre.x += m.elements[12];
        centre.z += m.elements[14];
      }
      centre.x /= n;
      centre.z /= n;
      if (Math.hypot(centre.x, centre.z) < FAR) return;
      // Round to a whole metre so the instances' new places are exact differences.
      centre.set(Math.round(centre.x), 0, Math.round(centre.z));
      for (let i = 0; i < n; i++) {
        inst.getMatrixAt(i, m);
        m.elements[12] -= centre.x;
        m.elements[14] -= centre.z;
        inst.setMatrixAt(i, m);
      }
      inst.instanceMatrix.needsUpdate = true;
      inst.boundingSphere = null;
      inst.boundingBox = null;
    } else {
      if ((users.get(g) ?? 0) !== 1 || Object.keys(g.morphAttributes).length) return;
      const pos = g.getAttribute('position') as THREE.BufferAttribute | undefined;
      if (!pos || pos.usage === THREE.DynamicDrawUsage) return;
      if (!g.boundingBox) g.computeBoundingBox();
      g.boundingBox!.getCenter(centre);
      if (Math.hypot(centre.x, centre.z) < FAR) return;
      centre.set(Math.round(centre.x), 0, Math.round(centre.z));
      g.translate(-centre.x, 0, -centre.z);
    }
    // The object takes up what its vertices gave: in its parent's frame, through its own turn and scale.
    shift.copy(centre).multiply(o.scale).applyQuaternion(o.quaternion);
    o.position.add(shift);
    for (const child of o.children) child.position.sub(centre);
    o.updateMatrix();
    moved++;
  });
  root.updateMatrixWorld(true);
  return moved;
}
