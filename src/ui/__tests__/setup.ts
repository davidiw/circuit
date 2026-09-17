// Browser-only APIs the UI touches, for jsdom.
import { vi } from 'vitest';
if (!('matchMedia' in globalThis) || typeof window.matchMedia !== 'function') {
  (globalThis as unknown as { __narrow: boolean }).__narrow = false;
  Object.defineProperty(window, 'matchMedia', { writable: true, value: (q: string) => ({ matches: q.includes('max-width: 640px') ? (globalThis as unknown as { __narrow: boolean }).__narrow : false, media: q, onchange: null, addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false }) });
}
if (!('ResizeObserver' in globalThis)) { (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class { observe() {} unobserve() {} disconnect() {} }; }
if (!('IntersectionObserver' in globalThis)) { (globalThis as unknown as { IntersectionObserver: unknown }).IntersectionObserver = class { observe() {} unobserve() {} disconnect() {} }; }
(globalThis as unknown as { fetch: unknown }).fetch = vi.fn(async () => ({ ok: true, json: async () => ({ configured: false }) }));
if (!(SVGElement.prototype as unknown as { createSVGPoint?: unknown }).createSVGPoint) { (SVGElement.prototype as unknown as { createSVGPoint: unknown }).createSVGPoint = () => ({ x: 0, y: 0, matrixTransform: () => ({ x: 0, y: 0 }) }); }
