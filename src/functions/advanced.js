/**
 * Advanced system functions: SOLVE, assertions, and stubs for future features.
 *
 * These provide the constraint/assertion system and placeholder
 * implementations for extended features (calculus, generators, etc.)
 */

import { Integer, Rational } from "@ratmath/core";

function toNumber(val) {
    if (val instanceof Integer) return Number(val.value);
    if (val instanceof Rational) return Number(val.numerator) / Number(val.denominator);
    if (typeof val === "number") return val;
    if (typeof val === "bigint") return Number(val);
    return NaN;
}

export const advancedFunctions = {
    SOLVE: {
        lazy: true,
        impl(args, context, evaluate) {
            // SOLVE(name, expr) — set variable to the value that satisfies expr
            // For now, just evaluate the expression and assign it
            const name = args[0];
            const value = evaluate(args[1]);
            context.set(name, value);
            return { type: "constraint", name, value, satisfied: true };
        },
        doc: "Solve/constrain: x :=: expr",
    },

    ASSERT_LT: {
        impl(args) {
            const a = toNumber(args[0]);
            const b = toNumber(args[1]);
            if (!(a < b)) {
                throw new Error(`Assertion failed: ${a} < ${b}`);
            }
            return new Integer(1);
        },
        pure: true,
        doc: "Assert a < b (:<:)",
    },

    ASSERT_LTE: {
        impl(args) {
            const a = toNumber(args[0]);
            const b = toNumber(args[1]);
            if (!(a <= b)) {
                throw new Error(`Assertion failed: ${a} <= ${b}`);
            }
            return new Integer(1);
        },
        pure: true,
        doc: "Assert a <= b (:<=:)",
    },

    ASSERT_GT: {
        impl(args) {
            const a = toNumber(args[0]);
            const b = toNumber(args[1]);
            if (!(a > b)) {
                throw new Error(`Assertion failed: ${a} > ${b}`);
            }
            return new Integer(1);
        },
        pure: true,
        doc: "Assert a > b (:>:)",
    },

    ASSERT_GTE: {
        impl(args) {
            const a = toNumber(args[0]);
            const b = toNumber(args[1]);
            if (!(a >= b)) {
                throw new Error(`Assertion failed: ${a} >= ${b}`);
            }
            return new Integer(1);
        },
        pure: true,
        doc: "Assert a >= b (:>=:)",
    },

    // --- Stubs for future features ---

    DERIVATIVE: {
        impl(args) {
            return {
                type: "stub",
                name: "DERIVATIVE",
                args,
                message: "Symbolic derivatives are not yet implemented",
            };
        },
        pure: true,
        doc: "Symbolic derivative (future)",
    },

    INTEGRAL: {
        impl(args) {
            return {
                type: "stub",
                name: "INTEGRAL",
                args,
                message: "Symbolic integration is not yet implemented",
            };
        },
        pure: true,
        doc: "Symbolic integral (future)",
    },

    GENERATOR: {
        impl(args) {
            return {
                type: "stub",
                name: "GENERATOR",
                args,
                message: "Generators are not yet implemented",
            };
        },
        pure: true,
        doc: "Sequence generator (future)",
    },

    STEP: {
        impl(args) {
            return {
                type: "stub",
                name: "STEP",
                args,
                message: "Step function is not yet implemented",
            };
        },
        pure: true,
        doc: "Step/range generator (future)",
    },

    MATRIX: {
        impl(args) {
            // Basic matrix as nested array
            return { type: "matrix", rows: args };
        },
        pure: true,
        doc: "Matrix literal",
    },

    TENSOR: {
        impl(args) {
            return { type: "tensor", data: args };
        },
        pure: true,
        doc: "Tensor literal",
    },

    UNIT: {
        impl(args) {
            return { type: "unit", value: args[0], unit: args[1] };
        },
        pure: true,
        doc: "Scientific unit annotation (future)",
    },

    MATHUNIT: {
        impl(args) {
            return { type: "mathunit", value: args[0], unit: args[1] };
        },
        pure: true,
        doc: "Mathematical unit annotation (future)",
    },
};
