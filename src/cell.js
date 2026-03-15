/**
 * Cell helpers for RiX assignment semantics.
 *
 * A variable names a cell. A cell is a mutable box (Cell object) containing
 * a value. Meta is stored on the value object via `_ext` (a Map).
 *
 * Cells enable true aliasing: `b = a` makes b and a share the same Cell
 * object. `a ~= newValue` mutates the Cell in-place (both see the change).
 * `a = expr` creates a new Cell for a without affecting b's Cell.
 *
 * Meta keys are classified by prefix:
 *   - ordinary:  no leading underscore  (e.g. "key", "mutable", "frozen")
 *   - ephemeral: single underscore      (e.g. "_spec", "_deriv")
 *   - sticky:    double underscore       (e.g. "__units")
 *
 * Assignment operators differ in how they handle value and meta:
 *   =    alias/rebind — share the same Cell (variable rhs) or fresh Cell (expr rhs)
 *   :=   fresh copy   — shallow-copy value + all meta into new Cell
 *   ~=   in-place     — replace value inside Cell, preserve ordinary meta,
 *                        replace ephemeral wholesale, preserve sticky unless rhs overrides
 *   ::=  deep copy    — like := but deep
 *   ~~=  deep update  — like ~= but deep copies
 */

// ─── Cell ─────────────────────────────────────────────────────────────

/**
 * A mutable value box. All scope bindings store Cell objects so that
 * aliasing (`b = a`) shares a single Cell and `~=` can mutate in-place.
 */
export class Cell {
    constructor(value) {
        this.value = value;
    }
}

import { Integer, Rational, RationalInterval } from "@ratmath/core";
import { isTensor, computeDefaultStrides } from "./tensor.js";

// ─── Meta key classification ─────────────────────────────────────────

/**
 * Classify a meta key by its prefix.
 * @param {string} name
 * @returns {"ordinary"|"ephemeral"|"sticky"}
 */
export function classifyMetaKey(name) {
    if (name.startsWith("__")) return "sticky";
    if (name.startsWith("_")) return "ephemeral";
    return "ordinary";
}

// ─── Shallow / deep value copy ───────────────────────────────────────

/**
 * Shallow-copy a RiX value. Returns a NEW object so that _ext can be
 * set independently from the source (critical for ~= meta transfer).
 * Numeric ratmath types (Integer, Rational, RationalInterval) get fresh
 * instances because they are used as plain objects but may carry _ext.
 * Collections get a new top-level container with the same element references.
 */
export function shallowCopyValue(value) {
    if (value == null) return value;
    if (typeof value !== "object") return value;

    // Ratmath numeric types — create fresh instances so _ext is independent
    if (value instanceof Integer) return new Integer(value.value);
    if (value instanceof Rational) return new Rational(value.numerator, value.denominator);
    if (value instanceof RationalInterval) {
        return new RationalInterval(
            new Rational(value.low.numerator, value.low.denominator),
            new Rational(value.high.numerator, value.high.denominator),
        );
    }

    // String object — always creates a new plain object
    if (value.type === "string") return { type: "string", value: value.value };

    // Sequence
    if (value.type === "sequence") {
        return {
            type: "sequence",
            values: [...value.values],
            _ext: value._ext ? new Map(value._ext) : undefined,
        };
    }

    // Tuple
    if (value.type === "tuple") {
        return {
            type: "tuple",
            values: [...value.values],
            _ext: value._ext ? new Map(value._ext) : undefined,
        };
    }

    // Map
    if (value.type === "map" && value.entries instanceof Map) {
        return {
            type: "map",
            entries: new Map(value.entries),
            _ext: value._ext ? new Map(value._ext) : undefined,
        };
    }

    if (value.type === "export_bundle" && value.entries instanceof Map) {
        return {
            type: "export_bundle",
            entries: new Map(value.entries),
            _ext: value._ext ? new Map(value._ext) : undefined,
        };
    }

    // Set
    if (value.type === "set") {
        return {
            type: "set",
            values: [...value.values],
            _ext: value._ext ? new Map(value._ext) : undefined,
        };
    }

    // Tensor
    if (isTensor(value)) {
        return {
            type: "tensor",
            data: [...value.data],
            shape: [...value.shape],
            strides: [...value.strides],
            offset: value.offset,
            _ext: value._ext ? new Map(value._ext) : undefined,
        };
    }

    // Function / lambda / other object — return same reference (immutable def)
    return value;
}

/**
 * Deep-copy a RiX value. Recursively copies nested collections.
 */
export function deepCopyValue(value) {
    if (value == null) return value;
    if (typeof value !== "object") return value;
    if (value instanceof Integer) return new Integer(value.value);
    if (value instanceof Rational) return new Rational(value.numerator, value.denominator);
    if (value instanceof RationalInterval) {
        return new RationalInterval(
            new Rational(value.low.numerator, value.low.denominator),
            new Rational(value.high.numerator, value.high.denominator),
        );
    }

    if (value.type === "string") return { type: "string", value: value.value };

    if (value.type === "sequence") {
        return {
            type: "sequence",
            values: value.values.map(deepCopyValue),
            _ext: value._ext ? deepCopyMeta(value._ext) : undefined,
        };
    }

    if (value.type === "tuple") {
        return {
            type: "tuple",
            values: value.values.map(deepCopyValue),
            _ext: value._ext ? deepCopyMeta(value._ext) : undefined,
        };
    }

    if (value.type === "map" && value.entries instanceof Map) {
        const newEntries = new Map();
        for (const [k, v] of value.entries) {
            newEntries.set(k, deepCopyValue(v));
        }
        return {
            type: "map",
            entries: newEntries,
            _ext: value._ext ? deepCopyMeta(value._ext) : undefined,
        };
    }

    if (value.type === "export_bundle" && value.entries instanceof Map) {
        const newEntries = new Map();
        for (const [k, v] of value.entries) {
            newEntries.set(k, new Cell(deepCopyValue(v.value)));
        }
        return {
            type: "export_bundle",
            entries: newEntries,
            _ext: value._ext ? deepCopyMeta(value._ext) : undefined,
        };
    }

    if (value.type === "set") {
        return {
            type: "set",
            values: value.values.map(deepCopyValue),
            _ext: value._ext ? deepCopyMeta(value._ext) : undefined,
        };
    }

    if (isTensor(value)) {
        return {
            type: "tensor",
            data: value.data.map(deepCopyValue),
            shape: [...value.shape],
            strides: [...value.strides],
            offset: value.offset,
            _ext: value._ext ? deepCopyMeta(value._ext) : undefined,
        };
    }

    return value;
}

// ─── Meta copy helpers ───────────────────────────────────────────────

/**
 * Deep-copy a meta Map, recursively deep-copying each meta value.
 */
function deepCopyMeta(meta) {
    const result = new Map();
    for (const [key, val] of meta) {
        result.set(key, deepCopyValue(val));
    }
    return result;
}

/**
 * Ensure a value object has a _ext Map. Returns the _ext Map.
 * Throws if value is not an object (cannot attach meta to primitives).
 * For primitives that need meta, caller should wrap them first.
 */
function ensureExt(obj) {
    if (!obj || typeof obj !== "object") {
        throw new Error(`Cannot attach meta properties to ${typeof obj}`);
    }
    if (!obj._ext) {
        obj._ext = new Map();
    }
    return obj._ext;
}

/**
 * Copy ALL meta from source value to target value.
 * Used by := (ASSIGN_COPY).
 * @param {*} source - source value with _ext
 * @param {*} target - target value to receive meta
 * @param {"shallow"|"deep"} depth
 */
export function copyAllMeta(source, target, depth) {
    const srcMeta = source?._ext;
    if (!srcMeta || srcMeta.size === 0) return;
    if (!target || typeof target !== "object") return;

    const tgtMeta = ensureExt(target);
    for (const [key, val] of srcMeta) {
        tgtMeta.set(key, depth === "deep" ? deepCopyValue(val) : val);
    }
}

/**
 * Transfer meta during in-place value replacement (~= / ~~=).
 *
 * Rules:
 *   ordinary meta → preserved from oldValue (NOT copied from rhs)
 *   ephemeral (_)  → replaced wholesale from rhsValue
 *   sticky (__)    → preserved from oldValue UNLESS rhsValue supplies the same key
 *
 * Special: mutable/frozen/immutable/locked are ordinary meta preserved from old.
 * If lhs is a new cell (oldValue is null), no old meta to preserve.
 *
 * @param {*} oldValue  - the value being replaced (may be null if new cell)
 * @param {*} newValue  - the new value to install (will receive meta)
 * @param {*} rhsValue  - the rhs value (source for ephemeral + sticky overrides)
 * @param {"shallow"|"deep"} depth
 */
export function transferMetaForUpdate(oldValue, newValue, rhsValue, depth) {
    if (!newValue || typeof newValue !== "object") return;

    // Capture meta refs BEFORE touching newValue._ext (guards against
    // newValue === rhsValue, which can happen for immutable ratmath types
    // that shallowCopyValue might still share in edge cases).
    const oldMeta = oldValue?._ext;
    const rhsMeta = rhsValue?._ext;

    if (!oldMeta && !rhsMeta) return;

    // Always create a FRESH meta map — never merge into newValue's existing _ext,
    // which might be shared with rhsValue.
    const tgtMeta = new Map();
    newValue._ext = tgtMeta;
    const copyVal = depth === "deep" ? deepCopyValue : (v) => v;

    // 1. Ordinary meta — preserve from old value
    if (oldMeta) {
        for (const [key, val] of oldMeta) {
            if (classifyMetaKey(key) === "ordinary") {
                tgtMeta.set(key, copyVal(val));
            }
        }
    }

    // 2. Sticky meta — preserve from old, overwrite if rhs supplies
    if (oldMeta) {
        for (const [key, val] of oldMeta) {
            if (classifyMetaKey(key) === "sticky") {
                tgtMeta.set(key, copyVal(val));
            }
        }
    }
    if (rhsMeta) {
        for (const [key, val] of rhsMeta) {
            if (classifyMetaKey(key) === "sticky") {
                tgtMeta.set(key, copyVal(val));
            }
        }
    }

    // 3. Ephemeral meta — replaced wholesale from rhs only
    if (rhsMeta) {
        for (const [key, val] of rhsMeta) {
            if (classifyMetaKey(key) === "ephemeral") {
                tgtMeta.set(key, copyVal(val));
            }
        }
    }
    // Old ephemeral is NOT copied — that's what "replaced wholesale" means
}
