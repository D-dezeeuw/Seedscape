// Compile a single shader stage; throws with the GLSL info log on failure.
function compileShader(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type);
  if (!shader) throw new Error("gl.createShader returned null");
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader) ?? "(no log)";
    gl.deleteShader(shader);
    const stage = type === gl.VERTEX_SHADER ? "vertex" : "fragment";
    throw new Error(`${stage} shader compile failed:\n${log}`);
  }
  return shader;
}

export function createProgram(
  gl: WebGL2RenderingContext,
  vertexSource: string,
  fragmentSource: string,
): WebGLProgram {
  const vs = compileShader(gl, gl.VERTEX_SHADER, vertexSource);
  const fs = compileShader(gl, gl.FRAGMENT_SHADER, fragmentSource);
  const program = gl.createProgram();
  if (!program) {
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    throw new Error("gl.createProgram returned null");
  }
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  // Shaders can be deleted after linking; the program retains them.
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(program) ?? "(no log)";
    gl.deleteProgram(program);
    throw new Error(`program link failed:\n${log}`);
  }
  return program;
}

export function getUniformLocation(
  gl: WebGL2RenderingContext,
  program: WebGLProgram,
  name: string,
): WebGLUniformLocation {
  const loc = gl.getUniformLocation(program, name);
  if (!loc) throw new Error(`uniform "${name}" not found in program`);
  return loc;
}

export function getAttribLocation(
  gl: WebGL2RenderingContext,
  program: WebGLProgram,
  name: string,
): number {
  const loc = gl.getAttribLocation(program, name);
  if (loc < 0) throw new Error(`attribute "${name}" not found in program`);
  return loc;
}
