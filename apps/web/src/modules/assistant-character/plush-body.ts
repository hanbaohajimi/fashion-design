// One cloth surface bends gradually above the padded lower seam. The upper
  // embroidery and crown use the same transform as the top of this surface.
  export function createBodySurface(root: HTMLElement, canvas: HTMLCanvasElement, source: HTMLImageElement, invalidate: () => void) {
    const fallback = { draw() {}, resize() {}, dispose() {}, inspect: () => ({ mode: "image", draws: 0 }) };
    let context: WebGLRenderingContext | null = null;
    try { context = canvas.getContext("webgl", {
      alpha: true, premultipliedAlpha: true, antialias: false,
      depth: false, stencil: false, preserveDrawingBuffer: false
    }); } catch { /* The image fallback also works without WebGL. */ }
    if (!context) { root.dataset.bodySurface = "image"; return fallback; }
    const gl = context;
    let program: WebGLProgram | null = null, vertexBuffer: WebGLBuffer | null = null, indexBuffer: WebGLBuffer | null = null, texture: WebGLTexture | null = null;
    let ready = false, dead = false, lost = false, draws = 0, lastPose = "", pixels = 240;
    let angleLocation: WebGLUniformLocation | null = null, nodLocation: WebGLUniformLocation | null = null;
    const cols = 16, rows = 28, indexCount = cols * rows * 6;
    const vertexSource = `
      attribute vec2 a_uv;
      uniform float u_angle;
      uniform float u_nod;
      varying vec2 v_uv;
      void main() {
        vec2 original = vec2(173.0, 363.0) + a_uv * vec2(896.0, 799.0);
        vec2 pivot = vec2(626.0, 980.0);
        float weight = 1.0 - smoothstep(850.0, 1138.0, original.y);
        float c = cos(u_angle), s = sin(u_angle);
        vec2 d = original - pivot;
        vec2 turned = pivot + vec2(c*d.x - s*d.y, s*d.x + c*d.y);
        turned.y += u_nod;
        vec2 p = mix(original, turned, weight);
        vec2 uv = ((p - vec2(173.0, 74.0)) / vec2(896.0, 1120.0) + vec2(0.07, 0.05)) / vec2(1.14, 1.10);
        gl_Position = vec4(uv.x*2.0 - 1.0, 1.0 - uv.y*2.0, 0.0, 1.0);
        v_uv = a_uv;
      }
    `;
    const fragmentSource = `
      precision mediump float;
      varying vec2 v_uv;
      uniform sampler2D u_texture;
      void main() { gl_FragColor = texture2D(u_texture, v_uv); }
    `;
    function shader(type: number, text: string) {
      const item = gl.createShader(type);
      if (!item) throw new Error("Body shader unavailable");
      gl.shaderSource(item, text); gl.compileShader(item);
      if (!gl.getShaderParameter(item, gl.COMPILE_STATUS)) { gl.deleteShader(item); throw new Error("Body shader unavailable"); }
      return item;
    }
    function release() {
      if (texture) gl.deleteTexture(texture);
      if (vertexBuffer) gl.deleteBuffer(vertexBuffer);
      if (indexBuffer) gl.deleteBuffer(indexBuffer);
      if (program) gl.deleteProgram(program);
      texture = null; vertexBuffer = null; indexBuffer = null; program = null;
    }
    function visibility(value: boolean) {
      ready = value;
      root.dataset.bodySurface = value ? "mesh" : "image";
    }
    function resize(size: number) {
      pixels = size;
      const ratio = Math.min(2, Math.max(1.5, window.devicePixelRatio || 1));
      const w = Math.round(size * 1.14 * ratio), h = Math.round(size * 1.25 * 1.10 * ratio);
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w; canvas.height = h; lastPose = "";
      }
    }
    function initialize() {
      if (dead || lost || ready || !source.complete || !source.naturalWidth) return;
      let vertex: WebGLShader | null = null, fragment: WebGLShader | null = null;
      try {
        release();
        vertex = shader(gl.VERTEX_SHADER, vertexSource);
        fragment = shader(gl.FRAGMENT_SHADER, fragmentSource);
        program = gl.createProgram();
        if (!program) throw new Error("Body program unavailable");
        gl.attachShader(program, vertex); gl.attachShader(program, fragment);
        gl.linkProgram(program);
        if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error("Body program unavailable");
        const vertices: number[] = [], indices: number[] = [];
        for (let y = 0; y <= rows; y++) for (let x = 0; x <= cols; x++) vertices.push(x/cols, y/rows);
        for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
          const a = y*(cols+1)+x, b = a+1, c = a+cols+1, d = c+1;
          indices.push(a,b,c,b,d,c);
        }
        gl.useProgram(program);
        vertexBuffer = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(vertices), gl.STATIC_DRAW);
        const location = gl.getAttribLocation(program, "a_uv");
        gl.enableVertexAttribArray(location); gl.vertexAttribPointer(location, 2, gl.FLOAT, false, 0, 0);
        indexBuffer = gl.createBuffer(); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
        gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(indices), gl.STATIC_DRAW);
        texture = gl.createTexture(); gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.uniform1i(gl.getUniformLocation(program, "u_texture"), 0);
        angleLocation = gl.getUniformLocation(program, "u_angle");
        nodLocation = gl.getUniformLocation(program, "u_nod");
        gl.disable(gl.DEPTH_TEST); gl.disable(gl.BLEND); gl.clearColor(0,0,0,0);
        lastPose = ""; resize(pixels); visibility(true); invalidate();
      } catch {
        visibility(false); release(); invalidate();
      } finally {
        if (vertex) gl.deleteShader(vertex);
        if (fragment) gl.deleteShader(fragment);
      }
    }
    function draw(angle: number, nod: number) {
      if (!ready || dead || lost) return;
      const key = angle.toFixed(4) + ":" + nod.toFixed(4);
      if (key === lastPose) return;
      lastPose = key;
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.uniform1f(angleLocation, angle * Math.PI / 180);
      gl.uniform1f(nodLocation, nod * 896 / 240);
      gl.drawElements(gl.TRIANGLES, indexCount, gl.UNSIGNED_SHORT, 0); draws++;
    }
    const contextLost = (event: Event) => { event.preventDefault(); lost = true; visibility(false); invalidate(); };
    const contextRestored = () => { lost = false; initialize(); };
    canvas.addEventListener("webglcontextlost", contextLost);
    canvas.addEventListener("webglcontextrestored", contextRestored);
    source.addEventListener("load", initialize, { once: true });
    queueMicrotask(initialize);
    return {
      draw, resize,
      inspect: () => ({ mode: ready ? "mesh" : "image", draws, pixels: [canvas.width, canvas.height], triangles: indexCount / 3 }),
      dispose() {
        if (dead) return;
        visibility(false); dead = true;
        source.removeEventListener("load", initialize);
        canvas.removeEventListener("webglcontextlost", contextLost);
        canvas.removeEventListener("webglcontextrestored", contextRestored);
        release();
        // React may immediately reuse this canvas in StrictMode; GPU objects are already freed.
        if (!canvas.isConnected) gl.getExtension("WEBGL_lose_context")?.loseContext();
      }
    };
  }
