// Framegen 1.4.0 ships index.d.ts but omits the types condition from its
// package exports. Keep the suppression at this adapter boundary; the public
// shape used by the renderer is declared in frame-interpolator.ts.
// @ts-ignore Upstream package export metadata does not expose index.d.ts.
export { createRT } from 'framegen'
