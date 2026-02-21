/**
 * Property access, external properties, and mutation system functions.
 *
 * DOT, INDEX, DOT_ASSIGN, INDEX_ASSIGN — object/array access
 * EXTGET, EXTSET, EXTALL — external property layer (._ext)
 * KEYS, VALUES — map key/value extraction
 * MUTCOPY, MUTINPLACE — map mutation operators
 */

import { Integer } from "@ratmath/core";

/**
 * Get a property from a map-type object.
 * Supports: { type: "map", entries: Map } or plain objects.
 */
function getProperty(obj, key) {
    if (obj && obj.type === "map" && obj.entries instanceof Map) {
        return obj.entries.get(key);
    }
    if (obj && typeof obj === "object" && key in obj) {
        return obj[key];
    }
    return undefined;
}

/**
 * Set a property on a map-type object.
 */
function setProperty(obj, key, value) {
    if (obj && obj.type === "map" && obj.entries instanceof Map) {
        obj.entries.set(key, value);
        return value;
    }
    if (obj && typeof obj === "object") {
        obj[key] = value;
        return value;
    }
    throw new Error(`Cannot set property "${key}" on ${typeof obj}`);
}

/**
 * Get from a sequence by numeric index (1-based).
 */
function getIndex(obj, idx) {
    if (obj && (obj.type === "sequence" || obj.type === "tuple")) {
        let index;
        if (idx instanceof Integer) {
            index = Number(idx.value);
        } else if (typeof idx === "number" || typeof idx === "bigint") {
            index = Number(idx);
        } else {
            throw new Error(`Index must be numeric, got ${typeof idx}`);
        }
        // 1-based indexing
        return obj.values[index - 1];
    }
    // For maps, treat idx as a key
    if (obj && obj.type === "map" && obj.entries instanceof Map) {
        const key = idx instanceof Integer ? idx.toString() : String(idx);
        return obj.entries.get(key);
    }
    throw new Error(`Cannot index into ${obj?.type || typeof obj}`);
}

/**
 * Set element in a sequence by numeric index (1-based).
 */
function setIndex(obj, idx, value) {
    if (obj && (obj.type === "sequence" || obj.type === "tuple")) {
        let index;
        if (idx instanceof Integer) {
            index = Number(idx.value);
        } else if (typeof idx === "number" || typeof idx === "bigint") {
            index = Number(idx);
        } else {
            throw new Error(`Index must be numeric, got ${typeof idx}`);
        }
        obj.values[index - 1] = value;
        return value;
    }
    if (obj && obj.type === "map" && obj.entries instanceof Map) {
        const key = idx instanceof Integer ? idx.toString() : String(idx);
        obj.entries.set(key, value);
        return value;
    }
    throw new Error(`Cannot set index on ${obj?.type || typeof obj}`);
}

/**
 * Ensure an object has an external properties map.
 */
function ensureExt(obj) {
    if (!obj || typeof obj !== "object") {
        throw new Error(`Cannot attach external properties to ${typeof obj}`);
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

export const propertyFunctions = {
    DOT: {
        impl(args) {
            const obj = args[0];
            const prop = args[1];
            const result = getProperty(obj, prop);
            if (result === undefined) {
                throw new Error(`Property "${prop}" not found`);
            }
            return result;
        },
        doc: "Access a named property (obj.prop)",
    },

    INDEX: {
        impl(args) {
            const obj = args[0];
            const idx = args[1];
            return getIndex(obj, idx);
        },
        doc: "Access by index (obj[i])",
    },

    DOT_ASSIGN: {
        lazy: true,
        impl(args, context, evaluate) {
            // args: [objExpr, propName, valueExpr]
            const obj = evaluate(args[0]);
            const prop = args[1]; // raw string
            const value = evaluate(args[2]);
            setProperty(obj, prop, value);
            return value;
        },
        doc: "Assign to a named property (obj.prop = val)",
    },

    INDEX_ASSIGN: {
        lazy: true,
        impl(args, context, evaluate) {
            // args: [objExpr, idxExpr, valueExpr]
            const obj = evaluate(args[0]);
            const idx = evaluate(args[1]);
            const value = evaluate(args[2]);
            setIndex(obj, idx, value);
            return value;
        },
        doc: "Assign by index (obj[i] = val)",
    },

    EXTGET: {
        impl(args) {
            const obj = args[0];
            const prop = args[1];
            const ext = obj?._ext;
            if (!ext || !ext.has(prop)) {
                throw new Error(`External property "${prop}" not found`);
            }
            return ext.get(prop);
        },
        doc: "Access an external property (obj..prop)",
    },

    EXTSET: {
        lazy: true,
        impl(args, context, evaluate) {
            // args: [objExpr, propName, valueExpr]
            const obj = evaluate(args[0]);
            const prop = args[1];
            const value = evaluate(args[2]);
            const ext = ensureExt(obj);
            ext.set(prop, value);
            return value;
        },
        doc: "Set an external property (obj..prop = val)",
    },

    EXTALL: {
        impl(args) {
            const obj = args[0];
            const ext = obj?._ext;
            if (!ext) {
                return { type: "map", entries: new Map() };
            }
            return { type: "map", entries: new Map(ext) };
        },
        doc: "Get all external properties as a map (obj..)",
    },

    KEYS: {
        impl(args) {
            const obj = args[0];
            if (obj && obj.type === "map" && obj.entries instanceof Map) {
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
