import { requireGlObject } from '@overscan/types'
import type { FrameBuffer, Signal, Sink } from '@overscan/types'

const VERT = `#version 300 es
in vec2 a_pos;
out vec2 v_uv;
void main() {
  v_uv = a_pos * 0.5 + 0.5;
  gl_Position = vec4(a_pos, 0.0, 1.0);
}`

const FRAG = `#version 300 es
precision mediump float;
uniform sampler2D u_tex;
in vec2 v_uv;
out vec4 fragColor;
void main() {
  fragColor = texture(u_tex, vec2(v_uv.x, 1.0 - v_uv.y));
}`

function compile(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type)
  if (!shader) throw new Error('WebglDisplaySink: createShader failed')
  gl.shaderSource(shader, source)
  gl.compileShader(shader)
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader) ?? 'compile failed'
    gl.deleteShader(shader)
    throw new Error(`WebglDisplaySink: ${log}`)
  }
  return shader
}

function link(gl: WebGL2RenderingContext, vs: WebGLShader, fs: WebGLShader): WebGLProgram {
  const prog = requireGlObject(gl.createProgram(), 'WebglDisplaySink: createProgram failed')
  gl.attachShader(prog, vs)
  gl.attachShader(prog, fs)
  gl.linkProgram(prog)
  gl.deleteShader(vs)
  gl.deleteShader(fs)
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(prog) ?? 'link failed'
    gl.deleteProgram(prog)
    throw new Error(`WebglDisplaySink: ${log}`)
  }
  return prog
}

export class WebglDisplaySink implements Sink {
  readonly id = 'browser'

  private gl: WebGL2RenderingContext | null = null
  private program: WebGLProgram | null = null
  private vao: WebGLVertexArrayObject | null = null
  private texture: WebGLTexture | null = null
  private uTexLoc: WebGLUniformLocation | null = null

  constructor(private readonly canvas: HTMLCanvasElement) {}

  get context(): WebGL2RenderingContext {
    if (!this.gl) throw new Error('WebglDisplaySink not initialized')
    return this.gl
  }

  async init(width: number, height: number, _fps: number): Promise<void> {
    this.canvas.width = width
    this.canvas.height = height
    const gl = this.canvas.getContext('webgl2')
    if (!gl) throw new Error('WebGL2 context unavailable')
    this.gl = gl

    const program = link(gl, compile(gl, gl.VERTEX_SHADER, VERT), compile(gl, gl.FRAGMENT_SHADER, FRAG))
    this.program = program
    this.uTexLoc = gl.getUniformLocation(program, 'u_tex')

    const vao = requireGlObject(gl.createVertexArray(), 'WebglDisplaySink: vao/vbo failed')
    const vbo = requireGlObject(gl.createBuffer(), 'WebglDisplaySink: vao/vbo failed')
    this.vao = vao
    gl.bindVertexArray(vao)
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW)
    const aPos = gl.getAttribLocation(program, 'a_pos')
    gl.enableVertexAttribArray(aPos)
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0)

    const texture = requireGlObject(gl.createTexture(), 'WebglDisplaySink: texture failed')
    this.texture = texture
    gl.bindTexture(gl.TEXTURE_2D, texture)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
  }

  async write(frame: FrameBuffer, _frameIndex: number, _signal: Signal): Promise<void> {
    const gl = this.context
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    gl.viewport(0, 0, this.canvas.width, this.canvas.height)
    gl.useProgram(this.program)
    gl.bindVertexArray(this.vao)
    gl.activeTexture(gl.TEXTURE0)

    if (frame.texture) {
      gl.bindTexture(gl.TEXTURE_2D, frame.texture)
    } else {
      if (!this.texture) throw new Error('WebglDisplaySink: upload texture missing')
      gl.bindTexture(gl.TEXTURE_2D, this.texture)
      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        gl.RGBA,
        frame.width,
        frame.height,
        0,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        frame.data,
      )
    }

    gl.uniform1i(this.uTexLoc, 0)
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
  }

  async flush(): Promise<void> {}

  destroy(): void {
    if (!this.gl) return
    if (this.texture) this.gl.deleteTexture(this.texture)
    if (this.vao) this.gl.deleteVertexArray(this.vao)
    if (this.program) this.gl.deleteProgram(this.program)
    this.texture = null
    this.vao = null
    this.program = null
    this.uTexLoc = null
    this.gl = null
  }
}
