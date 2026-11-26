import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import type { CourseData } from '@slack-tide/world';
import { DRY, SEABED, cutTriangle, drawnHeightIn, type DrawnGrid } from '../src/scene/landMesh';
import { buildLand, drawnLandHeight } from '../src/scene/terrain';

// The smooth-shore rule (scene/landMesh.ts): wherever land meets sea, the drawn shoreline follows a smoothed line
// through the cells instead of their edges, and what is read back (`drawnLandHeight`) is what is drawn (`buildLand`).

const N = 41;
const DX = 10;
const MAX = 820;
/** A cliff coast 30 m high whose edge runs at a slant across the grid: on the grid's points it is a staircase. */
const slant = (i: number, j: number) => i + 0.37 * j > 20;
const enc = (z: number) => Math.round(Math.sqrt(z / MAX) * 255);
function course(insets?: CourseData['terrain']['insets']): CourseData {
  return { terrain: { x0: 0, y0: 0, dx: DX, nx: N, ny: N, max: MAX, file: '', source: '', insets } } as unknown as CourseData;
}
const heights = new Uint8Array(N * N);
for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) heights[j * N + i] = slant(i, j) ? enc(30) : 0;
const drawn = drawnLandHeight(course(), heights);

/** Where the land meets the sea along a row, by stepping east until the drawn height first stands above zero. */
function shoreOnRow(h: (x: number, y: number) => number, y: number): number {
  for (let x = 0; x < (N - 1) * DX; x += 0.05) if (h(x, y) > 0) return x;
  return NaN;
}
/** The largest distance of a set of points from the straight line fitted through them. */
function wobble(pts: Array<[number, number]>): number {
  const n = pts.length;
  const my = pts.reduce((s, p) => s + p[1], 0) / n;
  const mx = pts.reduce((s, p) => s + p[0], 0) / n;
  const b = pts.reduce((s, p) => s + (p[1] - my) * (p[0] - mx), 0) / pts.reduce((s, p) => s + (p[1] - my) ** 2, 0);
  return Math.max(...pts.map(([x, y]) => Math.abs(x - (mx + b * (y - my)))));
}

describe('the drawn shoreline', () => {
  it('runs smoothly across the cells, not round their edges', () => {
    const smooth: Array<[number, number]> = [];
    // The plain rule this replaced: each triangle sloping straight from the land to the sea bed under the water point.
    const plain: DrawnGrid = { x0: 0, y0: 0, dx: DX, nx: N, ny: N, h: new Float32Array(N * N) };
    for (let k = 0; k < N * N; k++) plain.h[k] = heights[k] ? 30 : SEABED;
    const stairs: Array<[number, number]> = [];
    for (let y = 60; y <= 340; y += 2.5) {
      smooth.push([shoreOnRow(drawn, y), y]);
      stairs.push([shoreOnRow((x, yy) => {
        // The plain triangles, read the same way (no cut): all grid points on one side or the other is the plain plane.
        const g = { ...plain, fixed: undefined };
        const fx = x / DX;
        const fy = yy / DX;
        const i = Math.floor(fx);
        const j = Math.floor(fy);
        const u = fx - i;
        const v = fy - j;
        const a = g.h[j * N + i];
        const b = g.h[j * N + i + 1];
        const d = g.h[(j + 1) * N + i];
        const e = g.h[(j + 1) * N + i + 1];
        return u + v <= 1 ? a + (b - a) * u + (d - a) * v : e + (d - e) * (1 - u) + (b - e) * (1 - v);
      }, y), y]);
    }
    // The stair steps of the plain rule are most of a cell; the cut shore stays within a fifth of one of a straight line.
    expect(wobble(stairs)).toBeGreaterThan(0.4 * DX);
    expect(wobble(smooth)).toBeLessThan(0.2 * DX);
  });

  it('meets the sea at its height, and is continuous everywhere', () => {
    let last = drawn(0, 200.3);
    for (let x = 0.25; x < (N - 1) * DX; x += 0.25) {
      const z = drawn(x, 200.3);
      // A 30 m cliff over a few metres is steep, but never a step.
      expect(Math.abs(z - last), `at ${x}`).toBeLessThan(2.5);
      last = z;
    }
    expect(drawn(0, 200)).toBe(SEABED);
    expect(drawn(395, 200)).toBeCloseTo(30, 0);
  });

  it('cuts a triangle into pieces that keep its turn, one side land and the other water', () => {
    const pieces = cutTriangle([0, 1, 2], [0.5, -0.4, -0.2]);
    expect(pieces.map((p) => p.land)).toEqual([true, false, false]);
    expect(cutTriangle([0, 1, 2], [-1, -1, -1])).toHaveLength(1);
    // The edge points are where the value runs through zero.
    const c = pieces[0].c[1] as { a: number; b: number; t: number };
    expect(c.t).toBeCloseTo(0.5 / 0.9, 6);
  });

  it('is read back exactly as it is drawn, insets and all', () => {
    // An inset at 5 m over part of it, with its own finer staircase, meeting the 10 m grid at its edge.
    const fine = { x0: 100, y0: 100, dx: 5, nx: 41, ny: 41 };
    const fineCells = new Uint8Array(41 * 41);
    for (let j = 0; j < 41; j++) for (let i = 0; i < 41; i++) fineCells[j * 41 + i] = slant((fine.x0 + i * 5) / DX, (fine.y0 + j * 5) / DX) ? enc(22 + (i % 3)) : 0;
    const all = new Uint8Array(heights.length + fineCells.length);
    all.set(heights);
    all.set(fineCells, heights.length);
    const c = course([fine]);
    const land = buildLand(c, all);
    const read = drawnLandHeight(c, all);
    let checked = 0;
    let atShore = 0;
    land.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      const pos = mesh.geometry.getAttribute('position');
      const index = mesh.geometry.getIndex()!;
      for (let t = 0; t < index.count; t += 3) {
        const p = [0, 1, 2].map((q) => index.getX(t + q)).map((k) => [pos.getX(k), -pos.getZ(k), pos.getY(k)]);
        // The middle of each triangle stands where the reading says.
        const x = (p[0][0] + p[1][0] + p[2][0]) / 3;
        const y = (p[0][1] + p[1][1] + p[2][1]) / 3;
        const z = (p[0][2] + p[1][2] + p[2][2]) / 3;
        expect(read(x, y), `${mesh.name} at ${x.toFixed(1)}, ${y.toFixed(1)}`).toBeCloseTo(z, 3);
        checked++;
        for (const q of p) if (q[2] === 0) atShore++;
      }
    });
    expect(checked).toBeGreaterThan(1000);
    expect(atShore).toBeGreaterThan(100);
    // A point on land is above the waterline, one at sea below it.
    expect(read(390, 200)).toBeGreaterThan(DRY);
    expect(read(10, 200)).toBeLessThan(0);
  });

  it('reads one grid the same through its own cut as through drawnHeightIn', () => {
    const g: DrawnGrid = { x0: 0, y0: 0, dx: DX, nx: N, ny: N, h: new Float32Array(N * N) };
    for (let k = 0; k < N * N; k++) g.h[k] = heights[k] ? (heights[k] / 255) ** 2 * MAX : SEABED;
    const land = (x: number, y: number) => slant(Math.round(x / DX), Math.round(y / DX));
    for (let y = 5; y < 400; y += 37) for (let x = 3; x < 400; x += 29) expect(drawnHeightIn(g, x, y, land)).toBeCloseTo(drawn(x, y), 6);
  });
});
