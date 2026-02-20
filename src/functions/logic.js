/**
 * Logic system functions: AND, OR, NOT
 *
 * Truthy = non-zero for numeric ratmath types.
 * Returns Integer(1) for true, Integer(0) for false.
 */

import { Integer, Rational } from "@ratmath/core";

function isTruthy(val) {
    if (val === null || val === undefined) return false;
    if (val instanceof Integer) return val.value !== 0n;
    if (val instanceof Rational) return val.numerator !== 0n;
    if (typeof val === "number") return val !== 0;
    if (typeof val === "bigint") return val !== 0n;
    return Boolean(val);
}

function boolToInt(val) {
    return new Integer(val ? 1 : 0);
}

export const logicFunctions = {
    AND: {
        impl(args) {
            for (const arg of args) {
                if (!isTruthy(arg)) return boolToInt(false);
            }
            return boolToInt(true);
        },
        pure: true,
        doc: "Logical AND (short-circuits on first falsy)",
    },

    OR: {
        impl(args) {
            for (const arg of args) {
                if (isTruthy(arg)) return boolToInt(true);
            }
            return boolToInt(false);
        },
        pure: true,
        doc: "Logical OR (short-circuits on first truthy)",
    },

    NOT: {
        impl(args) {
            return boolToInt(!isTruthy(args[0]));
        },
        pure: true,
        doc: "Logical NOT",
    },
};
