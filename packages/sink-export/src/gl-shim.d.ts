declare module 'gl' {
  function createContext(
    width: number,
    height: number,
  ): WebGLRenderingContext & { destroy(): void }
  export default createContext
}
