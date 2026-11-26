import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { recentre } from '../src/scene/recentre';

/** Every vertex of a mesh in world coordinates. */
function worldVerts(mesh: THREE.Mesh): number[][] {
  mesh.updateWorldMatrix(true, false);
  const p = mesh.geometry.getAttribute('position');
  const v = new THREE.Vector3();
  const out: number[][] = [];
  for (let i = 0; i < p.count; i++) out.push(v.fromBufferAttribute(p, i).applyMatrix4(mesh.matrixWorld).toArray());
  return out;
}

describe('recentring what was built in course positions', () => {
  it('moves the distance out of the vertices into the object, and nothing moves on the screen', () => {
    const g = new THREE.BoxGeometry(10, 4, 6).translate(10750, 2, -19500);
    const mesh = new THREE.Mesh(g);
    const child = new THREE.Object3D();
    child.position.set(10760, 3, -19490);
    mesh.add(child);
    const root = new THREE.Group();
    root.add(mesh);
    const before = worldVerts(mesh);
    const childBefore = child.getWorldPosition(new THREE.Vector3());
    expect(recentre(root)).toBe(1);
    const after = worldVerts(mesh);
    for (let i = 0; i < before.length; i++) for (let k = 0; k < 3; k++) expect(after[i][k]).toBeCloseTo(before[i][k], 9);
    // Heights are left as they were, for whatever reads them back.
    const ys = g.getAttribute('position');
    for (let i = 0; i < ys.count; i++) expect(Math.abs(ys.getY(i) - 2)).toBeLessThanOrEqual(2);
    expect(Math.max(...Array.from({ length: ys.count }, (_, i) => Math.abs(ys.getX(i))))).toBeLessThan(10);
    expect(child.getWorldPosition(new THREE.Vector3()).distanceTo(childBefore)).toBeLessThan(1e-9);
  });

  it('moves an instanced mesh by its instances, and leaves shared and nearby geometry alone', () => {
    const shape = new THREE.BoxGeometry(1, 1, 1);
    const inst = new THREE.InstancedMesh(shape, undefined, 3);
    const m = new THREE.Matrix4();
    const places = [[-2300, 1, 22900], [-2280, 1, 22950], [-2350, 2, 22920]];
    places.forEach(([x, y, z], i) => inst.setMatrixAt(i, m.makeTranslation(x, y, z)));
    const shared = new THREE.BoxGeometry(1, 1, 1).translate(5000, 0, 5000);
    const a = new THREE.Mesh(shared);
    const b = new THREE.Mesh(shared);
    const near = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2));
    const root = new THREE.Group();
    root.add(inst, a, b, near);
    expect(recentre(root)).toBe(1);
    root.updateMatrixWorld(true);
    const p = new THREE.Vector3();
    places.forEach(([x, y, z], i) => {
      inst.getMatrixAt(i, m);
      expect(Math.abs(m.elements[12])).toBeLessThan(100);
      p.setFromMatrixPosition(m).applyMatrix4(inst.matrixWorld);
      expect(p.distanceTo(new THREE.Vector3(x, y, z))).toBeLessThan(1e-9);
    });
    expect(a.position.length()).toBe(0);
    expect(near.position.length()).toBe(0);
  });
});
