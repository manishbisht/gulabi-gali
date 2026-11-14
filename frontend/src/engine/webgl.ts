/** True when this browser can give us a WebGL2 context (three needs it, not WebGL1). Probes on a throwaway canvas and frees it. */
export function hasWebGL(): boolean {
  try {
    const canvas = document.createElement('canvas')
    const gl = canvas.getContext('webgl2')
    if (!gl) return false
    gl.getExtension('WEBGL_lose_context')?.loseContext()
    return true
  } catch {
    return false
  }
}
