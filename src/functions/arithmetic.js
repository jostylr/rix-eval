/**
 * Arithmetic system functions: ADD, SUB, MUL, DIV, INTDIV, MOD, POW, NEG
 *
 * Uses ratmath core type methods for exact arithmetic.
 */

import { Integer, Rational } from "@ratmath/core";

/**
 * Ensure a value is a ratmath numeric type.
 * Native numbers/BigInts get wrapped as Integer.
 */
function ensureNumeric(val) {
    if (val instanceof Integer || val instanceof Rational) return val;
    if (typeof val === "bigint") return new Integer(val);
    if (typeof val === "number") {
        if (Number.isInteger(val)) return new Integer(val);
        // Approximate: convert to rational
        const str = val.toString();
        const parts = str.split(".");
        if (parts.length === 2) {
            const den = 10n ** BigInt(parts[1].length);
            const num = BigInt(parts[0]) * den + BigInt(parts[1]);
            return new Rational(num, den);
        }
        return new Integer(val);
    }
    throw new Error(`Cannot use ${typeof val} in arithmetic`);
}

export const arithmeticFunctions = {
    ADD: {
        impl(args) {
            const a = ensureNumeric(args[0]);
            const b = ensureNumeric(args[1]);
            return a.add(b);
        },
        pure: true,
        doc: "Addition",
    },

    SUB: {
        impl(args) {
            const a = ensureNumeric(args[0]);
            const b = ensureNumeric(args[1]);
            return a.subtract(b);
        },
        pure: true,
        doc: "Subtraction",
    },

    MUL: {
        impl(args) {
            const a = ensureNumeric(args[0]);
            const b = ensureNumeric(args[1]);
            return a.multiply(b);
        },
        pure: true,
        doc: "Multiplication",
    },

    DIV: {
        impl(args) {
            const a = ensureNumeric(args[0]);
            const b = ensureNumeric(args[1]);
            return a.divide(b);
        },
        pure: true,
        doc: "Division",
    },

    INTDIV: {
        impl(args) {
            const a = ensureNumeric(args[0]);
            const b = ensureNumeric(args[1]);
            if (a instanceof Integer && b instanceof Integer) {
                const result = a.value / b.value;
                return new Integer(result);
            }
            // For rationals, floor division
            const rat = a.divide(b);
            if (rat instanceof Rational) {
                return new Integer(rat.numerator / rat.denominator);
            }
            return new Integer(rat.value);
        },
        pure: true,
        doc: "Integer division (floor)",
    },

    MOD: {
        impl(args) {
            const a = ensureNumeric(args[0]);
            const b = ensureNumeric(args[1]);
            if (a instanceof Integer && b instanceof Integer) {
                return a.modulo(b);
            }
            // Fallback for mixed types
            const aVal = a instanceof Integer ? a.value : a.numerator;
            const bVal = b instanceof Integer ? b.value : b.numerator;
            return new Integer(aVal % bVal);
        },
        pure: true,
        doc: "Modulo",
    },

    POW: {
        impl(args) {
            const base = ensureNumeric(args[0]);
            const exp = ensureNumeric(args[1]);
            const expValue = exp instanceof Integer ? exp.value : Number(exp.toString());
            return base.pow(expValue);
        },
        pure: true,
        doc: "Exponentiation",
    },

    NEG: {
        impl(args) {
            const a = ensureNumeric(args[0]);
            return a.negate();
        },
        pure: true,
        doc: "Negation",
    },
};
