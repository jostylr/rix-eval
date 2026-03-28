/**
 * Comparison system functions: EQ, NEQ, LT, GT, LTE, GTE, SAME_CELL
 *
 * Return Integer(1) for true, null for false.
 * (In RiX, only null is falsy; 0 is truthy.)
 */

import { Integer, Rational } from "@ratmath/core";

function compare(a, b) {
    // Both have .equals and .subtract (ratmath types)
    if (a && b && typeof a.subtract === "function" && typeof b.subtract === "function") {
        const diff = a.subtract(b);
        return diff.sign();
    }
    const valA = a && a.type === "string" ? a.value : a;
    const valB = b && b.type === "string" ? b.value : b;
    // Fallback for primitives
    if (valA < valB) return -1;
    if (valA > valB) return 1;
    return 0;
}

function boolResult(val) {
    return val ? new Integer(1) : null;
}

function classifyMinMaxType(val) {
    if (val === null || val === undefined) return null;
    if (val instanceof Integer || val instanceof Rational) return "number";
    if (typeof val === "number" || typeof val === "bigint") return "number";
    if (typeof val === "string") return "string";
    if (val && typeof val === "object" && val.type === "string") return "string";
    return "invalid";
}

/**
 * Resolve an IR node to its Cell reference (if it names a variable).
 * Returns the Cell object or null if the node is not a simple variable reference.
 */
function resolveCell(irNode, context) {
    if (!irNode || typeof irNode !== "object") return null;
    if (irNode.fn === "RETRIEVE") {
        return context.getCell(irNode.args[0]);
    }
    if (irNode.fn === "OUTER_RETRIEVE") {
        return context.getOuterCell(irNode.args[0]);
    }
    return null;
}

function minMaxImpl(args, mode) {
    const filtered = args.filter((v) => v !== null && v !== undefined);
    if (filtered.length === 0) {
        throw new Error(`${mode} requires at least one non-null comparable argument`);
    }

    const valueType = classifyMinMaxType(filtered[0]);
    if (valueType === "invalid") {
        throw new Error(`${mode} only supports numbers or strings`);
    }
    for (let i = 1; i < filtered.length; i++) {
        const t = classifyMinMaxType(filtered[i]);
        if (t === "invalid" || t !== valueType) {
            throw new Error(`${mode} arguments must all be numbers or all be strings`);
        }
    }

    let best = filtered[0];
    for (let i = 1; i < filtered.length; i++) {
        const c = compare(filtered[i], best);
        if ((mode === "MIN" && c < 0) || (mode === "MAX" && c > 0)) {
            best = filtered[i];
        }
    }
    return best;
}

export const comparisonFunctions = {
    EQ: {
        impl(args) {
            const [a, b] = args;
            if (a && b && typeof a.equals === "function") {
                return boolResult(a.equals(b));
            }
            if (a && b && a.type === "string" && b.type === "string") return boolResult(a.value === b.value); return boolResult(a === b);
        },
        pure: true,
        doc: "Equality check — returns 1 or null",
    },

    NEQ: {
        impl(args) {
            const [a, b] = args;
            if (a && b && typeof a.equals === "function") {
                return boolResult(!a.equals(b));
            }
            if (a && b && a.type === "string" && b.type === "string") return boolResult(a.value !== b.value); return boolResult(a !== b);
        },
        pure: true,
        doc: "Inequality check — returns 1 or null",
    },

    LT: {
        impl(args) {
            return boolResult(compare(args[0], args[1]) < 0);
        },
        pure: true,
        doc: "Less than — returns 1 or null",
    },

    GT: {
        impl(args) {
            return boolResult(compare(args[0], args[1]) > 0);
        },
        pure: true,
        doc: "Greater than — returns 1 or null",
    },

    LTE: {
        impl(args) {
            return boolResult(compare(args[0], args[1]) <= 0);
        },
        pure: true,
        doc: "Less than or equal — returns 1 or null",
    },

    GTE: {
        impl(args) {
            return boolResult(compare(args[0], args[1]) >= 0);
        },
        pure: true,
        doc: "Greater than or equal — returns 1 or null",
    },

    SAME_CELL: {
        lazy: true,
        impl(args, context, evalFn) {
            // Resolve Cell references for both sides
            const leftCell = resolveCell(args[0], context);
            const rightCell = resolveCell(args[1], context);
            if (leftCell && rightCell && leftCell === rightCell) {
                return new Integer(1);
            }
            return null;
        },
        doc: "Identity comparison (===) — returns 1 if both sides refer to the same cell, null otherwise",
    },

    MIN: {
        impl(args) {
            return minMaxImpl(args, "MIN");
        },
        pure: true,
        doc: "Minimum over n arguments (ignores nulls)",
    },

    MAX: {
        impl(args) {
            return minMaxImpl(args, "MAX");
        },
        pure: true,
        doc: "Maximum over n arguments (ignores nulls)",
    },
};
