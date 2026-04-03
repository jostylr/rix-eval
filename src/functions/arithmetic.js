/**
 * Arithmetic system functions: ADD, SUB, MUL, DIV, INTDIV, MOD, POW, POWPROD, NEG
 *
 * Uses ratmath core type methods for exact arithmetic.
 */

import { Integer, Rational } from "@ratmath/core";
import { formatValue } from "../format.js";

/**
 * Ensure a value is a ratmath numeric type.
 * Native numbers/BigInts get wrapped as Integer.
 */
function ensureNumeric(val) {
    if (val instanceof Integer || val instanceof Rational) return val;
    // Robust check for ratmath types across different instances of core
    if (val && typeof val === "object" && typeof val.add === "function" && typeof val.multiply === "function") return val;
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
        return new Integer(BigInt(Math.floor(val)));
    }
    
    if (typeof val === "function" || (val && typeof val === "object" && (val.type === "lambda" || val.type === "function" || val.type === "pattern_function" || val.type === "sysref" || val.type === "partial" || val.type === "arityCap"))) {
        throw new Error("Cannot use function/lambda in arithmetic. If you intended to call a function, its name must be Capitalised.");
    }

    throw new Error(`Cannot use ${typeof val} in arithmetic`);
}

function stringify(val) {
    return formatValue(val);
}

function toQuotientParts(value) {
    if (value instanceof Integer) {
        return { numerator: value.value, denominator: 1n };
    }
    if (value instanceof Rational) {
        return { numerator: value.numerator, denominator: value.denominator };
    }
    return { numerator: BigInt(value.toString()), denominator: 1n };
}

function ceilDiv(numerator, denominator) {
    const q = numerator / denominator;
    const r = numerator % denominator;
    if (r === 0n) return q;
    return numerator >= 0n ? q + 1n : q;
}

function roundDiv(numerator, denominator) {
    const absNum = numerator < 0n ? -numerator : numerator;
    const floor = absNum / denominator;
    const remainder = absNum % denominator;
    const rounded = remainder * 2n >= denominator ? floor + 1n : floor;
    return numerator < 0n ? -rounded : rounded;
}

export const arithmeticFunctions = {
    ADD: {
        impl(args) {
            if (args.length === 0) return new Integer(0n);
            if (args.length === 1) return args[0];

            // String concatenation support
            const isStr = (v) => typeof v === "string" || (v && typeof v === "object" && v.type === "string");
            const getStr = (v) => stringify(v);

            if (args.some(isStr)) {
                return { type: "string", value: args.map(getStr).join("") };
            }

            let result = ensureNumeric(args[0]);
            for (let i = 1; i < args.length; i++) {
                result = result.add(ensureNumeric(args[i]));
            }
            return result;
        },
        pure: true,
        doc: "Addition or string concatenation",
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
            if (args.length === 0) return new Integer(1n);
            if (args.length === 1) return ensureNumeric(args[0]);

            let result = ensureNumeric(args[0]);
            for (let i = 1; i < args.length; i++) {
                result = result.multiply(ensureNumeric(args[i]));
            }
            return result;
        },
        pure: true,
        doc: "Multiplication (Product of values)",
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

    DIVUP: {
        impl(args) {
            const a = ensureNumeric(args[0]);
            const b = ensureNumeric(args[1]);
            const quotient = a.divide(b);
            const { numerator, denominator } = toQuotientParts(quotient);
            return new Integer(ceilDiv(numerator, denominator));
        },
        pure: true,
        doc: "Ceiling division",
    },

    DIVROUND: {
        impl(args) {
            const a = ensureNumeric(args[0]);
            const b = ensureNumeric(args[1]);
            const quotient = a.divide(b);
            const { numerator, denominator } = toQuotientParts(quotient);
            return new Integer(roundDiv(numerator, denominator));
        },
        pure: true,
        doc: "Rounded division",
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

    POWPROD: {
        impl(args) {
            const base = ensureNumeric(args[0]);
            const exp = ensureNumeric(args[1]);
            const expValue = exp instanceof Integer ? exp.value : Number(exp.toString());
            return base.pow(expValue);
        },
        pure: true,
        doc: "Exponentiation/product power (currently same implementation as POW)",
    },

    NEG: {
        impl(args) {
            const a = ensureNumeric(args[0]);
            return a.negate();
        },
        pure: true,
        doc: "Negation",
    },

    ABS: {
        impl(args) {
            const a = ensureNumeric(args[0]);
            return a instanceof Integer
                ? new Integer(a.value < 0n ? -a.value : a.value)
                : new Rational(a.numerator < 0n ? -a.numerator : a.numerator, a.denominator);
        },
        pure: true,
        doc: "Absolute value",
    },

    SQRT: {
        impl(args) {
            const a = ensureNumeric(args[0]);
            // Convert to number for Math.sqrt
            const val = a instanceof Rational
                ? Number(a.numerator) / Number(a.denominator)
                : Number(a.toString());
            const root = Math.sqrt(val);
            // Convert back to Integer/Rational
            if (Number.isInteger(root)) return new Integer(BigInt(root));
            // Approximate rational
            const str = root.toString();
            const parts = str.split(".");
            if (parts.length === 2) {
                const den = 10n ** BigInt(parts[1].length);
                const num = BigInt(parts[0]) * den + BigInt(parts[1]);
                return new Rational(num, den);
            }
            return new Integer(BigInt(Math.floor(root)));
        },
        pure: true,
        doc: "Square root (approximate rational)",
    },
};
