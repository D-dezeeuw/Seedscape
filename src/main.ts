import { createGLContext, resizeCanvasToDisplaySize, WebGL2UnsupportedError } from "./core/canvas";

function showUnsupportedMessage(): void {
  const banner = document.createElement("div");
  banner.style.cssText =
    "position:fixed;inset:0;display:grid;place-items:center;background:#1a262e;color:#e8eaed;font:16px/1.4 system-ui,sans-serif;padding:2rem;text-align:center;";
  banner.textContent =
    "Seedscape requires a browser with WebGL2 support. Please update your browser to continue.";
  document.body.replaceChildren(banner);
}

function bootstrap(): void {
  const canvas = document.querySelector<HTMLCanvasElement>("#seedscape-canvas");
  if (!canvas) {
    throw new Error("Missing #seedscape-canvas element in DOM.");
  }

  let gl: WebGL2RenderingContext;
  try {
    gl = createGLContext(canvas);
  } catch (err) {
    if (err instanceof WebGL2UnsupportedError) {
      showUnsupportedMessage();
      return;
    }
    throw err;
  }

  const draw = (): void => {
    if (resizeCanvasToDisplaySize(canvas)) {
      gl.viewport(0, 0, canvas.width, canvas.height);
    }
    gl.clearColor(0.1, 0.15, 0.2, 1.0);
    gl.clear(gl.COLOR_BUFFER_BIT);
  };

  gl.viewport(0, 0, canvas.width, canvas.height);
  draw();
  window.addEventListener("resize", draw);
}

bootstrap();
