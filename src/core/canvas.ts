export class WebGL2UnsupportedError extends Error {
  constructor() {
    super("WebGL2 is required but not available in this browser.");
    this.name = "WebGL2UnsupportedError";
  }
}

export function createGLContext(canvas: HTMLCanvasElement): WebGL2RenderingContext {
  const gl = canvas.getContext("webgl2", {
    alpha: false,
    antialias: false,
    depth: false,
    stencil: false,
    preserveDrawingBuffer: false,
    powerPreference: "high-performance",
  });

  if (!gl) {
    throw new WebGL2UnsupportedError();
  }

  return gl;
}

export function resizeCanvasToDisplaySize(
  canvas: HTMLCanvasElement,
  dpr = window.devicePixelRatio,
): boolean {
  const displayWidth = Math.floor(canvas.clientWidth * dpr);
  const displayHeight = Math.floor(canvas.clientHeight * dpr);
  if (canvas.width !== displayWidth || canvas.height !== displayHeight) {
    canvas.width = displayWidth;
    canvas.height = displayHeight;
    return true;
  }
  return false;
}
