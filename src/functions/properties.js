/**
 * Property access, meta properties, and mutation system functions.
 *
 * META_GET, META_SET, META_ALL, META_MERGE — meta property layer (._ext)
 * INDEX_GET, INDEX_SET — collection index/key access
 * KEYS, VALUES — map key/value extraction
 * MUTCOPY, MUTINPLACE — map mutation operators
 */

import { Integer } from "@ratmath/core";
import { keyOf, canonicalizeMetaKey } from "./keyof.js";
import { Cell } from "../cell.js";
import { isTensor, tensorAssignBySelectors, tensorGetBySelectors } from "../tensor.js";

/**
 * Convert a key value to a numeric index.
 */
function toInteger(key) {
    if (key instanceof Integer) return Number(key.value);
    if (typeof key === "number" || typeof key === "bigint") return Number(key);
    throw new Error(`Index must be numeric, got ${typeof key}`);
}

/**
 * Ensure an object has a meta properties map (_ext).
 */
function ensureMeta(obj) {
    if (!obj || typeof obj !== "object") {
        throw new Error(`Cannot attach meta properties to ${typeof obj}`);
    }
    if (!obj._ext) {
        obj._ext = new Map();
    }
    return obj._ext;
}

/**
 * Clone a map object for MUTCOPY.
 */
function cloneMapObj(obj) {
    if (obj && obj.type === "map" && obj.entries instanceof Map) {
        return {
            type: "map",
            entries: new Map(obj.entries),
            _ext: obj._ext ? new Map(obj._ext) : undefined,
        };
    }
    // For plain objects, shallow clone
    if (obj && typeof obj === "object") {
        return { ...obj };
    }
    throw new Error(`Cannot clone ${typeof obj} for mutation`);
}

/**
 * Apply mutation operations to a map object.
 * Operations: [{ action: "add"|"remove"|"merge", key, value? }, ...]
 */
function applyMutations(target, ops) {
    if (!Array.isArray(ops)) return target;

    for (const op of ops) {
        if (!op || typeof op !== "object") continue;

        const { action, key, value } = op;

        if (target.type === "map" && target.entries instanceof Map) {
            switch (action) {
                case "add":
                    target.entries.set(key, value);
                    break;
                case "remove":
                    target.entries.delete(key);
                    break;
                case "merge":
                    // value should be another map to merge
                    if (value && value.type === "map" && value.entries instanceof Map) {
                        for (const [k, v] of value.entries) {
                            target.entries.set(k, v);
                        }
                    }
                    break;
            }
        }
    }
    return target;
}

function assertMutableIndexTarget(obj) {
    const ext = obj?._ext;
    if (!ext?.get("_mutable")) {
        throw new Error("Cannot set index: collection is not mutable. Set meta property '._mutable' to a non-null value first.");
    }
}

function indexGetResolved(obj, key) {
    if (isTensor(obj)) {
        return tensorGetBySelectors(obj, [{ kind: "index", value: key }]);
    }

    // Sequences / tuples (1-based, negative allowed)
    if (obj && (obj.type === "sequence" || obj.type === "tuple")) {
        const idx = toInteger(key);
        const len = obj.values.length;
        const i = idx < 0 ? len + idx : idx - 1;
        if (i < 0 || i >= len) return null;
        return obj.values[i];
    }

    // Strings (1-based character access)
    if (obj && obj.type === "string") {
        const idx = toInteger(key);
        const s = obj.value;
        const i = idx < 0 ? s.length + idx : idx - 1;
        if (i < 0 || i >= s.length) return null;
        return { type: "string", value: s[i] };
    }

    // Maps — string or value keys
    if (obj && obj.type === "map" && obj.entries instanceof Map) {
        const mapKey = keyOf(key);
        return obj.entries.has(mapKey) ? obj.entries.get(mapKey) : null;
    }

    if (obj && obj.type === "export_bundle" && obj.entries instanceof Map) {
        const mapKey = keyOf(key);
        return obj.entries.has(mapKey) ? obj.entries.get(mapKey).value : null;
    }

    // Callable types — arity-cap syntax: fn[n]
    if (obj && (obj.type === "function" || obj.type === "lambda" ||
                obj.type === "sysref" || obj.type === "partial" || obj.type === "arityCap")) {
        let n;
        try { n = toInteger(key); } catch (_) {
            throw new Error("Arity cap must be a non-negative integer");
        }
        if (!Number.isInteger(n) || n < 0) {
            throw new Error(`Arity cap must be a non-negative integer, got ${n}`);
        }
        return { type: "arityCap", fn: obj, cap: n };
    }

    throw new Error(`Type "${obj?.type || typeof obj}" is not indexable`);
}

function indexSetResolved(obj, key, value) {
    assertMutableIndexTarget(obj);

    if (isTensor(obj)) {
        return tensorAssignBySelectors(obj, [{ kind: "index", value: key }], value);
    }

    if (obj && (obj.type === "sequence" || obj.type === "tuple")) {
        const idx = toInteger(key);
        const len = obj.values.length;
        const i = idx < 0 ? len + idx : idx - 1;
        obj.values[i] = value;
        return value;
    }

    if (obj && obj.type === "map" && obj.entries instanceof Map) {
        const mapKey = keyOf(key);
        obj.entries.set(mapKey, value);
        return value;
    }

    if (obj && obj.type === "export_bundle" && obj.entries instanceof Map) {
        const mapKey = keyOf(key);
        const cell = obj.entries.get(mapKey);
        if (cell instanceof Cell) {
            cell.value = value;
        } else {
            obj.entries.set(mapKey, new Cell(value));
        }
        return value;
    }

    throw new Error(`Cannot set index on "${obj?.type || typeof obj}"`);
}

function decodeBracketSpec(specNode, evaluate) {
    if (specNode && specNode.fn === "FULL_SLICE") {
        return { kind: "full" };
    }
    if (specNode && specNode.fn === "SLICE_SPEC") {
        return {
            kind: "slice",
            start: evaluate(specNode.args[0]),
            end: evaluate(specNode.args[1]),
        };
    }
    return {
        kind: "index",
        value: evaluate(specNode),
    };
}

export const propertyFunctions = {
    META_GET: {
        impl(args) {
            const obj = args[0];
            const prop = args[1];
            const ext = obj?._ext;
            if (!ext || !ext.has(prop)) return null;
            return ext.get(prop);
        },
        doc: "Get meta property (returns null if absent) — obj.name",
    },

    META_SET: {
        lazy: true,
        impl(args, context, evaluate) {
            // args: [objExpr, propName (raw string), valueExpr]
            const obj = evaluate(args[0]);
            const prop = args[1];      // raw string
            const value = evaluate(args[2]);

            // Immutability checks
            const ext = obj?._ext;
            if (ext) {
                if (ext.get("immutable")) {
                    throw new Error(`Cannot set meta property "${prop}": object is immutable`);
                }
                if (ext.get("frozen") && prop !== "frozen") {
                    throw new Error(`Cannot set meta property "${prop}": object is frozen`);
                }
            }

            const metaMap = ensureMeta(obj);
            if (prop === "key") {
                if (value === null) {
                    throw new Error("Cannot delete .key once set");
                }
                const canonical = canonicalizeMetaKey(value);
                const existing = metaMap.get("key");
                if (existing !== undefined) {
                    const existingCanonical = canonicalizeMetaKey(existing);
                    if (existingCanonical !== canonical) {
                        throw new Error(`Cannot change .key once set (existing: "${existingCanonical}", new: "${canonical}")`);
                    }
                }
                const canonicalString = { type: "string", value: canonical };
                metaMap.set("key", canonicalString);
                return canonicalString;
            }

            if (value === null) {
                metaMap.delete(prop);  // null = delete
            } else {
                metaMap.set(prop, value);
            }
            return value;
        },
        doc: "Set meta property (null deletes; respects immutable/frozen) — obj.name = val",
    },

    META_ALL: {
        impl(args) {
            const obj = args[0];
            const ext = obj?._ext;
            if (!ext) {
                return { type: "map", entries: new Map() };
            }
            return { type: "map", entries: new Map(ext) };  // read-only copy
        },
        doc: "Get all meta properties as a map (read-only copy) — obj..",
    },

    META_MERGE: {
        lazy: true,
        impl(args, context, evaluate) {
            const obj = evaluate(args[0]);
            const mergeMap = evaluate(args[1]);

            // Check immutability
            const ext = obj?._ext;
            if (ext?.get("immutable")) throw new Error("Cannot merge meta: object is immutable");
            if (ext?.get("frozen")) throw new Error("Cannot merge meta: object is frozen");

            if (!mergeMap || mergeMap.type !== "map") {
                throw new Error("META_MERGE requires a map on the right side");
            }

            const metaMap = ensureMeta(obj);
            for (const [key, value] of mergeMap.entries) {
                if (value === null) {
                    metaMap.delete(key);  // null = delete
                } else {
                    metaMap.set(key, value);
                }
            }
            return obj;
        },
        doc: "Bulk merge map into object meta properties (null values = delete) — obj .= map",
    },

    INDEX_GET: {
        impl(args) {
            return indexGetResolved(args[0], args[1]);
        },
        doc: "Index into collection (1-based for sequences; string or value keys for maps) — obj[i]",
    },

    INDEX_SET: {
        lazy: true,
        impl(args, context, evaluate) {
            // args: [objExpr, keyExpr, valueExpr]
            const obj = evaluate(args[0]);
            const key = evaluate(args[1]);
            const value = evaluate(args[2]);

            return indexSetResolved(obj, key, value);
        },
        doc: "Set index in collection (requires ._mutable meta flag) — obj[i] = val",
    },

    BRACKET_GET: {
        lazy: true,
        impl(args, context, evaluate) {
            const obj = evaluate(args[0]);
            const specCount = args[1];
            const specNodes = args.slice(2, 2 + specCount);
            const specs = specNodes.map((specNode) => decodeBracketSpec(specNode, evaluate));

            if (isTensor(obj)) {
                return tensorGetBySelectors(obj, specs);
            }

            if (specs.length === 1 && specs[0].kind === "index") {
                return indexGetResolved(obj, specs[0].value);
            }

            throw new Error("Bracket slicing is only supported for tensors");
        },
        doc: "Tensor-aware bracket indexing and slicing",
    },

    BRACKET_SET: {
        lazy: true,
        impl(args, context, evaluate) {
            const obj = evaluate(args[0]);
            const specCount = args[1];
            const specNodes = args.slice(2, 2 + specCount);
            const value = evaluate(args[2 + specCount]);
            const specs = specNodes.map((specNode) => decodeBracketSpec(specNode, evaluate));

            if (isTensor(obj)) {
                assertMutableIndexTarget(obj);
                return tensorAssignBySelectors(obj, specs, value);
            }

            if (specs.length === 1 && specs[0].kind === "index") {
                return indexSetResolved(obj, specs[0].value, value);
            }

            throw new Error("Bracket slice assignment is only supported for tensors");
        },
        doc: "Tensor-aware bracket assignment",
    },

    KEYOF: {
        impl(args) {
            return { type: "string", value: keyOf(args[0]) };
        },
        pure: true,
        doc: "Resolve canonical map key string for a value",
    },

    KEYS: {
        impl(args) {
            const obj = args[0];
            if (obj && obj.type === "map" && obj.entries instanceof Map) {
                const keys = Array.from(obj.entries.keys());
                return { type: "set", values: keys };
            }
            if (obj && obj.type === "export_bundle" && obj.entries instanceof Map) {
                const keys = Array.from(obj.entries.keys());
                return { type: "set", values: keys };
            }
            return { type: "set", values: [] };
        },
        pure: true,
        doc: "Get the keys of a map as a set (obj.|)",
    },

    VALUES: {
        impl(args) {
            const obj = args[0];
            if (obj && obj.type === "map" && obj.entries instanceof Map) {
                const vals = Array.from(obj.entries.values());
                return { type: "set", values: vals };
            }
            if (obj && obj.type === "export_bundle" && obj.entries instanceof Map) {
                const vals = Array.from(obj.entries.values(), (cell) => cell.value);
                return { type: "set", values: vals };
            }
            return { type: "set", values: [] };
        },
        pure: true,
        doc: "Get the values of a map as a set (obj|.)",
    },

    MUTCOPY: {
        impl(args) {
            // args[0] = target object (already evaluated)
            // args[1] = array of mutation operations
            const target = args[0];
            const ops = args[1];
            const clone = cloneMapObj(target);
            return applyMutations(clone, ops);
        },
        doc: "Clone a map and apply mutations (obj{= +a=3, -.b })",
    },

    MUTINPLACE: {
        impl(args) {
            // args[0] = target object (already evaluated)
            // args[1] = array of mutation operations
            const target = args[0];
            const ops = args[1];
            return applyMutations(target, ops);
        },
        doc: "Mutate a map in-place (obj{! +a=3, -.b })",
    },
};
