import { requireGlObject } from '@overscan/types'
const VERT = `#version 300 es
in vec2 a_pos;
out vec2 v_uv;
void main() {
  v_uv = a_pos * 0.5 + 0.5;
  gl_Position = vec4(a_pos, 0.0, 1.0);
}`

export interface FullscreenPipeline {
  program: WebGLProgram
  vao: WebGLVertexArrayObject
  uniforms: Record<string, WebGLUniformLocation | null>
}

function compile(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type)
  if (!shader) throw new Error('createShader failed')
  gl.shaderSource(shader, source)
  gl.compileShader(shader)
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader) ?? 'compile failed'
    gl.deleteShader(shader)
    throw new Error(log)
  }
  return shader
}

export function createFullscreenPipeline(
  gl: WebGL2RenderingContext,
  fragmentSource: string,
  uniformNames: string[],
): FullscreenPipeline {
  const vs = compile(gl, gl.VERTEX_SHADER, VERT)
  const fs = compile(gl, gl.FRAGMENT_SHADER, fragmentSource)
  const program = requireGlObject(gl.createProgram(), 'createProgram failed')
  gl.attachShader(program, vs)
  gl.attachShader(program, fs)
  gl.linkProgram(program)
  gl.deleteShader(vs)
  gl.deleteShader(fs)
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(program) ?? 'link failed'
    gl.deleteProgram(program)
    throw new Error(log)
  }

  const vao = requireGlObject(gl.createVertexArray(), 'create quad buffers failed')
  const vbo = requireGlObject(gl.createBuffer(), 'create quad buffers failed')
  gl.bindVertexArray(vao)
  gl.bindBuffer(gl.ARRAY_BUFFER, vbo)
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW)
  const aPos = gl.getAttribLocation(program, 'a_pos')
  gl.enableVertexAttribArray(aPos)
  gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0)

  const uniforms: Record<string, WebGLUniformLocation | null> = {}
  for (const name of uniformNames) uniforms[name] = gl.getUniformLocation(program, name)
  return { program, vao, uniforms }
}

export function bindTexture(
  gl: WebGL2RenderingContext,
  unit: number,
  texture: WebGLTexture,
  location: WebGLUniformLocation | null,
): void {
  gl.activeTexture(gl.TEXTURE0 + unit)
  gl.bindTexture(gl.TEXTURE_2D, texture)
  if (location) gl.uniform1i(location, unit)
}

export function bindEdgeTransform(
  gl: WebGL2RenderingContext,
  uniforms: Record<string, WebGLUniformLocation | null>,
  prefix: string,
  transform: { position: [number, number]; scale: [number, number]; rotation?: number } | undefined,
): void {
  const pos = transform?.position ?? [0, 0]
  const scale = transform?.scale ?? [1, 1]
  const rotation = transform?.rotation ?? 0
  gl.uniform2f(uniforms[`${prefix}Pos`] ?? null, pos[0], pos[1])
  gl.uniform2f(uniforms[`${prefix}Scale`] ?? null, scale[0], scale[1])
  gl.uniform1f(uniforms[`${prefix}Rot`] ?? null, rotation)
  gl.uniform1f(uniforms[`${prefix}Enabled`] ?? null, transform ? 1 : 0)
}

export const EDGE_TRANSFORM_GLSL = `
vec2 applyEdgeTransform(vec2 uv, vec2 pos, vec2 scale, float rot, float enabled) {
  if (enabled < 0.5) return uv;
  vec2 p = uv;
  vec2 center = pos + scale * 0.5;
  vec2 q = p - center;
  float c = cos(-rot);
  float s = sin(-rot);
  vec2 qr = vec2(q.x * c - q.y * s, q.x * s + q.y * c);
  vec2 local = qr / max(scale, vec2(1e-6)) + 0.5;
  return local;
}

bool edgeTransformInside(vec2 uv, vec2 pos, vec2 scale, float rot, float enabled) {
  if (enabled < 0.5) return true;
  vec2 p = uv;
  vec2 center = pos + scale * 0.5;
  vec2 q = p - center;
  float c = cos(-rot);
  float s = sin(-rot);
  vec2 qr = vec2(q.x * c - q.y * s, q.x * s + q.y * c);
  vec2 local = qr / max(scale, vec2(1e-6)) + 0.5;
  return local.x >= 0.0 && local.x <= 1.0 && local.y >= 0.0 && local.y <= 1.0;
}
`

type Uniforms = FullscreenPipeline['uniforms']

/**
 * Draws `pipeline` over the whole of `target` (a framebuffer of `width`×`height`), with `input` bound to
 * `u_input` on texture unit 0. `setUniforms` sets the rest.
 */
export function drawFullscreen(
  gl: WebGL2RenderingContext,
  pipeline: FullscreenPipeline,
  target: WebGLFramebuffer,
  width: number,
  height: number,
  input: WebGLTexture,
  setUniforms: (u: Uniforms) => void,
): void {
  gl.bindFramebuffer(gl.FRAMEBUFFER, target)
  gl.viewport(0, 0, width, height)
  gl.useProgram(pipeline.program)
  gl.bindVertexArray(pipeline.vao)
  bindTexture(gl, 0, input, pipeline.uniforms['u_input'] ?? null)
  setUniforms(pipeline.uniforms)
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
}

/** An offscreen RGBA8 texture with its framebuffer, for passes between a node's input and output. */
export interface RenderTarget {
  texture: WebGLTexture
  fbo: WebGLFramebuffer
  width: number
  height: number
}

/** Creates (or keeps, when the size still matches) a render target with nearest filtering. */
export function ensureRenderTarget(gl: WebGL2RenderingContext, current: RenderTarget | null, width: number, height: number): RenderTarget {
  if (current?.width === width && current.height === height) return current
  if (current) {
    gl.deleteTexture(current.texture)
    gl.deleteFramebuffer(current.fbo)
  }
  const texture = requireGlObject(gl.createTexture(), 'createTexture failed')
  gl.bindTexture(gl.TEXTURE_2D, texture)
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
  const fbo = requireGlObject(gl.createFramebuffer(), 'createFramebuffer failed')
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo)
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0)
  return { texture, fbo, width, height }
}

/**
 * GLSL helpers shared by the ports of CPU effects: integer pixel coordinates (row 0 is the top, as in
 * the CPU buffers), exact texel reads, and JavaScript's `Math.round`.
 */
export const PIXEL_GLSL = `
ivec2 pixelCoord() { return ivec2(gl_FragCoord.xy); }
vec4 texel(sampler2D tex, ivec2 p, ivec2 size) { return texelFetch(tex, clamp(p, ivec2(0), size - 1), 0); }
float jsRound(float v) { return floor(v + 0.5); }
`
