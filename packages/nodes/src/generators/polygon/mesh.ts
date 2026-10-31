/** Built-in meshes for the polygon renderer: unit-sized, centred, triangles wound counter-clockwise seen from outside. */

export type Vec3 = [number, number, number]
export type Tri = [number, number, number]

export interface Mesh {
  verts: Vec3[]
  tris: Tri[]
}

export type MeshName = 'cube' | 'octahedron' | 'icosahedron' | 'sphere' | 'glenz' | 'torus' | 'torus-knot'

export const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
export const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
export const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
export const normalize = (a: Vec3): Vec3 => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1
  return [a[0] / l, a[1] / l, a[2] / l]
}

/** Winds every triangle of a convex, centred mesh outward (its normal points away from the origin). */
function outward(mesh: Mesh): Mesh {
  const tris = mesh.tris.map(([a, b, c]): Tri => {
    const va = mesh.verts[a]!, vb = mesh.verts[b]!, vc = mesh.verts[c]!
    const n = cross(sub(vb, va), sub(vc, va))
    const centre: Vec3 = [(va[0] + vb[0] + vc[0]) / 3, (va[1] + vb[1] + vc[1]) / 3, (va[2] + vb[2] + vc[2]) / 3]
    return dot(n, centre) < 0 ? [a, c, b] : [a, b, c]
  })
  return { verts: mesh.verts, tris }
}

function cube(): Mesh {
  const verts: Vec3[] = [[-1, -1, -1], [1, -1, -1], [1, 1, -1], [-1, 1, -1], [-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]]
  const quads = [[0, 1, 2, 3], [4, 5, 6, 7], [0, 1, 5, 4], [3, 2, 6, 7], [0, 3, 7, 4], [1, 2, 6, 5]]
  const s = 0.62
  return outward({ verts: verts.map(v => [v[0] * s, v[1] * s, v[2] * s]), tris: quads.flatMap(([a, b, c, d]): Tri[] => [[a!, b!, c!], [a!, c!, d!]]) })
}

function octahedron(): Mesh {
  const verts: Vec3[] = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]
  const tris: Tri[] = []
  for (const x of [0, 1]) for (const y of [2, 3]) for (const z of [4, 5]) tris.push([x, y, z])
  return outward({ verts, tris })
}

function icosahedron(): Mesh {
  const p = (1 + Math.sqrt(5)) / 2
  const raw: Vec3[] = [[-1, p, 0], [1, p, 0], [-1, -p, 0], [1, -p, 0], [0, -1, p], [0, 1, p], [0, -1, -p], [0, 1, -p], [p, 0, -1], [p, 0, 1], [-p, 0, -1], [-p, 0, 1]]
  const tris: Tri[] = [
    [0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8],
    [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9], [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1],
  ]
  return outward({ verts: raw.map(normalize), tris })
}

/** Icosahedron split `levels` times and pushed onto the unit sphere. */
function sphere(levels = 2): Mesh {
  const base = icosahedron()
  const verts = base.verts
  let tris = base.tris
  for (let l = 0; l < levels; l++) {
    const cache = new Map<string, number>()
    const mid = (a: number, b: number): number => {
      const key = a < b ? `${a}:${b}` : `${b}:${a}`
      let i = cache.get(key)
      if (i === undefined) {
        const va = verts[a]!, vb = verts[b]!
        i = verts.push(normalize([(va[0] + vb[0]) / 2, (va[1] + vb[1]) / 2, (va[2] + vb[2]) / 2])) - 1
        cache.set(key, i)
      }
      return i
    }
    tris = tris.flatMap(([a, b, c]): Tri[] => {
      const ab = mid(a, b), bc = mid(b, c), ca = mid(c, a)
      return [[a, ab, ca], [b, bc, ab], [c, ca, bc], [ab, bc, ca]]
    })
  }
  return outward({ verts, tris })
}

/** The classic glenz object: a cube with a pyramid on each face (tetrakis hexahedron). */
function glenz(): Mesh {
  const c = cube()
  const verts = c.verts.slice()
  const tris: Tri[] = []
  const quads = [[0, 1, 2, 3], [4, 5, 6, 7], [0, 1, 5, 4], [3, 2, 6, 7], [0, 3, 7, 4], [1, 2, 6, 5]]
  for (const q of quads) {
    const cs = q.map(i => verts[i]!)
    const sum = (k: 0 | 1 | 2): number => cs.reduce((s, v) => s + v[k], 0) / 4
    const centre: Vec3 = [sum(0), sum(1), sum(2)]
    const tip = verts.push([centre[0] * 1.45, centre[1] * 1.45, centre[2] * 1.45]) - 1
    for (let i = 0; i < 4; i++) tris.push([q[i]!, q[(i + 1) % 4]!, tip])
  }
  return outward({ verts, tris })
}

/** A tube swept along a closed curve; `curve(s)` gives the centre for s in [0, 1). */
function tube(curve: (s: number) => Vec3, segments: number, sides: number, thickness: number): Mesh {
  const verts: Vec3[] = []
  for (let i = 0; i < segments; i++) {
    const s = i / segments
    const p = curve(s)
    const ahead = curve(s + 1e-3)
    const tangent = normalize(sub(ahead, p))
    // A frame around the tangent: any vector not parallel to it, made perpendicular.
    const helper: Vec3 = Math.abs(tangent[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0]
    const n = normalize(cross(tangent, helper))
    const b = cross(tangent, n)
    for (let j = 0; j < sides; j++) {
      const a = (j / sides) * Math.PI * 2
      const cos = Math.cos(a) * thickness, sin = Math.sin(a) * thickness
      verts.push([p[0] + n[0] * cos + b[0] * sin, p[1] + n[1] * cos + b[1] * sin, p[2] + n[2] * cos + b[2] * sin])
    }
  }
  const tris: Tri[] = []
  for (let i = 0; i < segments; i++) {
    const i2 = (i + 1) % segments
    for (let j = 0; j < sides; j++) {
      const j2 = (j + 1) % sides
      const a = i * sides + j, b = i2 * sides + j, c = i2 * sides + j2, d = i * sides + j2
      tris.push([a, b, c], [a, c, d])
    }
  }
  // Wind outward from the tube's centre line rather than the origin (the tube is not convex).
  const centreOf = (index: number): Vec3 => curve(Math.floor(index / sides) / segments)
  return {
    verts,
    tris: tris.map(([a, b, c]): Tri => {
      const va = verts[a]!, vb = verts[b]!, vc = verts[c]!
      const nrm = cross(sub(vb, va), sub(vc, va))
      return dot(nrm, sub(va, centreOf(a))) < 0 ? [a, c, b] : [a, b, c]
    }),
  }
}

function torus(): Mesh {
  return tube(s => [Math.cos(s * Math.PI * 2) * 0.72, Math.sin(s * Math.PI * 2) * 0.72, 0], 32, 14, 0.3)
}

/** A (2, 3) torus knot (trefoil). */
function torusKnot(): Mesh {
  return tube(s => {
    const a = s * Math.PI * 2
    const r = 0.5 + 0.22 * Math.cos(3 * a)
    return [r * Math.cos(2 * a), r * Math.sin(2 * a), 0.25 * Math.sin(3 * a)]
  }, 120, 10, 0.13)
}

const cache = new Map<MeshName, Mesh>()

export function builtinMesh(name: MeshName): Mesh {
  let mesh = cache.get(name)
  if (!mesh) {
    mesh = { cube, octahedron, icosahedron, sphere: () => sphere(2), glenz, torus, 'torus-knot': torusKnot }[name]()
    cache.set(name, mesh)
  }
  return mesh
}

/** Per-vertex normals: the average of the normals of the triangles that share each vertex. */
export function vertexNormals(mesh: Mesh): Vec3[] {
  const acc = mesh.verts.map((): Vec3 => [0, 0, 0])
  for (const [a, b, c] of mesh.tris) {
    const n = cross(sub(mesh.verts[b]!, mesh.verts[a]!), sub(mesh.verts[c]!, mesh.verts[a]!))
    for (const i of [a, b, c]) {
      const v = acc[i]!
      v[0] += n[0]; v[1] += n[1]; v[2] += n[2]
    }
  }
  return acc.map(normalize)
}
