export interface AtlasTexture {
  texture: WebGLTexture;
  textureSize: number;
  tileSize: number;
  tilesPerRow: number;
}

export interface AtlasManifest {
  textureSize: number;
  tileSize: number;
  tilesPerRow: number;
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Failed to load atlas image: ${url}`));
    img.src = url;
  });
}

export async function loadAtlas(
  gl: WebGL2RenderingContext,
  url: string,
  manifest: AtlasManifest,
): Promise<AtlasTexture> {
  const img = await loadImage(url);
  if (img.width !== manifest.textureSize || img.height !== manifest.textureSize) {
    throw new Error(
      `atlas dimension mismatch: image is ${img.width}x${img.height}, manifest expects ${manifest.textureSize}x${manifest.textureSize}`,
    );
  }

  const texture = gl.createTexture();
  if (!texture) throw new Error("gl.createTexture returned null");

  gl.bindTexture(gl.TEXTURE_2D, texture);
  // Flip on upload so the image's top row maps to UV.y = 1. Our vertex
  // shader uses world-Y-up convention (top of the rendered tile is the
  // higher worldY); without the flip, every texture renders upside down.
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
  // Pixel-art tiles: nearest filtering, no mipmaps. Prevents bleed between tiles.
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.bindTexture(gl.TEXTURE_2D, null);

  return {
    texture,
    textureSize: manifest.textureSize,
    tileSize: manifest.tileSize,
    tilesPerRow: manifest.tilesPerRow,
  };
}
