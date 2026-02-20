/**
 * Comparison system functions: EQ, NEQ, LT, GT, LTE, GTE
 *
 * All return Integer(1) for true, Integer(0) for false.
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

function boolToInt(val) {
    return new Integer(val ? 1 : 0);
}

export const comparisonFunctions = {
    EQ: {
        impl(args) {
            const [a, b] = args;
            if (a && b && typeof a.equals === "function") {
                return boolToInt(a.equals(b));
            }
            return boolToInt(a === b);
        },
        pure: true,
        doc: "Equality check",
    },

    NEQ: {
        impl(args) {
            const [a, b] = args;
            if (a && b && typeof a.equals === "function") {
                return boolToInt(!a.equals(b));
            }
            return boolToInt(a !== b);
        },
        pure: true,
        doc: "Inequality check",
    },

    LT: {
        impl(args) {
            return boolToInt(compare(args[0], args[1]) < 0);
        },
        pure: true,
        doc: "Less than",
    },

    GT: {
        impl(args) {
            return boolToInt(compare(args[0], args[1]) > 0);
        },
        pure: true,
        doc: "Greater than",
    },

    LTE: {
        impl(args) {
            return boolToInt(compare(args[0], args[1]) <= 0);
        },
        pure: true,
        doc: "Less than or equal",
    },

    GTE: {
        impl(args) {
            return boolToInt(compare(args[0], args[1]) >= 0);
        },
        pure: true,
        doc: "Greater than or equal",
    },
};
