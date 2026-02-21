/**
 * Comparison system functions: EQ, NEQ, LT, GT, LTE, GTE
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
    // Fallback for primitives
    if (a < b) return -1;
    if (a > b) return 1;
    return 0;
}

function boolResult(val) {
    return val ? new Integer(1) : null;
}

export const comparisonFunctions = {
    EQ: {
        impl(args) {
            const [a, b] = args;
            if (a && b && typeof a.equals === "function") {
                return boolResult(a.equals(b));
            }
            return boolResult(a === b);
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
            return boolResult(a !== b);
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
};
