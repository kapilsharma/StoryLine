// Extends `expect` with DOM matchers (toBeInTheDocument, etc.) for component tests.
// Harmless in node-env unit tests.
import '@testing-library/jest-dom/vitest'

/**
 * jsdom implements no `ResizeObserver`, and the family-tree canvas uses one to
 * track its viewport size. A no-op stub is the honest shim: it never fires, so a
 * component test sees the zero-sized viewport jsdom actually has, and nothing is
 * tempted to assert geometry here — that lives in the Playwright specs.
 */
if (typeof window !== 'undefined' && !('ResizeObserver' in window)) {
  class ResizeObserverStub {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  }
  ;(window as unknown as { ResizeObserver: unknown }).ResizeObserver = ResizeObserverStub
}
