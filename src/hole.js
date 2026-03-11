/**
 * HOLE sentinel for RiX undefined/hole semantics.
 * Distinct from null (which is a regular RiX value).
 */
export const HOLE = Object.freeze({ __rix_hole__: true });
export const isHole = (v) => v === HOLE;
