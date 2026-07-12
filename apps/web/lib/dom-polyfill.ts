import "server-only";

/**
 * PDF.js reads DOMMatrix at module evaluation time. On Vercel serverless there is
 * no browser DOM, so we must install a minimal matrix implementation before any
 * PDF library import runs.
 */
function polyfillDOMMatrix() {
  if (typeof globalThis.DOMMatrix !== "undefined") return;

  class DOMMatrixPolyfill {
    a = 1;
    b = 0;
    c = 0;
    d = 1;
    e = 0;
    f = 0;

    constructor(init?: number[]) {
      if (Array.isArray(init) && init.length === 6) {
        this.a = init[0]!;
        this.b = init[1]!;
        this.c = init[2]!;
        this.d = init[3]!;
        this.e = init[4]!;
        this.f = init[5]!;
      }
    }

    translateSelf(tx: number, ty = 0) {
      this.e = this.a * tx + this.c * ty + this.e;
      this.f = this.b * tx + this.d * ty + this.f;
      return this;
    }

    scaleSelf(sx: number, sy = sx) {
      this.a *= sx;
      this.b *= sx;
      this.c *= sy;
      this.d *= sy;
      return this;
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).DOMMatrix = DOMMatrixPolyfill;
}

function polyfillFinalizationRegistry() {
  if (typeof globalThis.FinalizationRegistry !== "undefined") return;

  class FinalizationRegistryPolyfill {
    register() {}
    unregister() {}
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).FinalizationRegistry = FinalizationRegistryPolyfill;
}

polyfillDOMMatrix();
polyfillFinalizationRegistry();
