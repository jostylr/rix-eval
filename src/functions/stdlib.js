/**
 * Standard Library compatibility functions for RiX.
 * These match Calc's built-in functions to support existing scripts.
 */

import { Integer } from "@ratmath/core";
import { coerceShapeValue, createTensor, forEachTensorCell, tensorIndexTuple, tensorSize, isTensor } from "../tensor.js";
import { callWithConcreteArgs } from "./functions.js";
import { formatValue } from "../format.js";
import { deepSetMutable } from "./core.js";

export const stdlibFunctions = {
    // --- Collection Functions ---
    LEN: {
        impl(args) {
            const coll = args[0];
            if (coll && (coll.type === "sequence" || coll.type === "tuple" || coll.type === "set")) {
                return new Integer(coll.values.length);
            }
            if (coll && coll.type === "map" && coll.entries instanceof Map) {
                return new Integer(coll.entries.size);
            }
            if (coll && coll.type === "export_bundle" && coll.entries instanceof Map) {
                return new Integer(coll.entries.size);
            }
            if (isTensor(coll)) {
                return new Integer(BigInt(tensorSize(coll)));
            }
            if (coll && typeof coll.value === "string") {
                return new Integer(coll.value.length);
            }
            return new Integer(0);
        },
        pure: true,
        doc: "Length of a collection or string",
    },

    FIRST: {
        impl(args) {
            const coll = args[0];
            if (coll && (coll.type === "sequence" || coll.type === "tuple" || coll.type === "set")) {
                return coll.values[0];
            }
            if (isTensor(coll)) {
                let first = null;
                let found = false;
                forEachTensorCell(coll, (value) => {
                    if (!found) {
                        first = value;
                        found = true;
                    }
                });
                return found ? first : null;
            }
            return null;
        },
        pure: true,
        doc: "First element of a collection",
    },

    LAST: {
        impl(args) {
            const coll = args[0];
            if (coll && (coll.type === "sequence" || coll.type === "tuple" || coll.type === "set")) {
                return coll.values[coll.values.length - 1];
            }
            if (isTensor(coll)) {
                let last = null;
                let found = false;
                forEachTensorCell(coll, (value) => {
                    last = value;
                    found = true;
                });
                return found ? last : null;
            }
            return null;
        },
        pure: true,
        doc: "Last element of a collection",
    },

    GETEL: {
        impl(args) {
            const coll = args[0];
            const idx = args[1];
            let index;
            if (idx instanceof Integer) index = Number(idx.value);
            else if (typeof idx === "number" || typeof idx === "bigint") index = Number(idx);

            if (coll && (coll.type === "sequence" || coll.type === "tuple" || coll.type === "set")) {
                return coll.values[index - 1]; // 1-based index
            }
            if (isTensor(coll)) {
                const target = idx instanceof Integer ? Number(idx.value) : Number(idx);
                let found = null;
                let seen = 0;
                forEachTensorCell(coll, (value) => {
                    seen += 1;
                    if (seen === target) {
                        found = value;
                    }
                });
                return found;
            }
            return null;
        },
        pure: true,
        doc: "Get element at index (1-based)",
    },

    IRANGE: {
        impl(args) {
            const start = args[0] instanceof Integer ? Number(args[0].value) : Number(args[0]);
            const end = args[1] instanceof Integer ? Number(args[1].value) : Number(args[1]);
            const values = [];
            for (let i = start; i <= end; i++) {
                values.push(new Integer(i));
            }
            return { type: "sequence", values };
        },
        pure: true,
        doc: "Create an integer range [start, end]",
    },

    // --- Functional (delegation to RiX names) ---
    MAP: {
        lazy: true,
        impl(args, _context, evaluate) {
            // MAP(coll, fn) -> PMAP(coll, fn)
            return evaluate({ fn: "PMAP", args: [args[0], args[1]] });
        },
        doc: "Map a function over a collection",
    },

    FILTER: {
        lazy: true,
        impl(args, _context, evaluate) {
            // FILTER(coll, pred) -> PFILTER(coll, pred)
            return evaluate({ fn: "PFILTER", args: [args[0], args[1]] });
        },
        doc: "Filter a collection",
    },

    REDUCE: {
        lazy: true,
        impl(args, _context, evaluate) {
            // REDUCE(coll, fn, init) -> PREDUCE(coll, fn, init)
            return evaluate({ fn: "PREDUCE", args: [args[0], args[1], args[2]] });
        },
        doc: "Reduce a collection",
    },

    TGEN: {
        lazy: true,
        impl(args, context, evaluate) {
            const shape = coerceShapeValue(evaluate(args[0]));
            const fn = evaluate(args[1]);
            const tensor = createTensor(shape);
            const filled = [];

            forEachTensorCell(tensor, (_value, tuple) => {
                filled.push(callWithConcreteArgs(fn, [tensorIndexTuple(tuple)], context, evaluate));
            });

            return createTensor(shape, filled);
        },
        doc: "Generate a tensor from a shape and index callback",
    },

    // --- Control Flow ---
    IF: {
        lazy: true,
        impl(args, _context, evaluate) {
            // IF(cond, trueVal, falseVal) -> TERNARY(cond, DEFER(trueVal), DEFER(falseVal))
            // Note: IF in stdlib usually evaluates its branches unless it's the specific lazy IF.
            // But we'll follow TERNARY logic for efficiency.
            return evaluate({
                fn: "TERNARY",
                args: [
                    args[0],
                    { fn: "DEFER", args: [args[1]] },
                    args[2] ? { fn: "DEFER", args: [args[2]] } : { fn: "NULL", args: [] }
                ]
            });
        },
        doc: "Conditional function IF(cond, t, f)",
    },

    MULTI: {
        lazy: true,
        impl(args, context, evaluate) {
            let result = null;
            for (const arg of args) {
                result = evaluate(arg);
            }
            return result;
        },
        doc: "Evaluate multiple expressions, return last",
    },

    // --- String Functions ---
    UPPER: {
        impl(args) {
            const val = args[0];
            const str = val?.value ?? String(val);
            return { type: "string", value: str.toUpperCase() };
        },
        pure: true,
        doc: "Convert string to uppercase",
    },

    SUBSTR: {
        impl(args) {
            const val = args[0];
            const str = val?.value ?? String(val);
            const start = args[1] instanceof Integer ? Number(args[1].value) : Number(args[1]);
            const len = args[2] instanceof Integer ? Number(args[2].value) : Number(args[2]);
            return { type: "string", value: str.substring(start, start + len) };
        },
        pure: true,
        doc: "Get substring",
    },

    RAND_NAME: {
        impl(args) {
            const lenArg = args[0];
            const alphabetArg = args[1];

            let len = 10;
            if (lenArg !== undefined && lenArg !== null) {
                if (lenArg instanceof Integer) len = Number(lenArg.value);
                else if (typeof lenArg === "number" || typeof lenArg === "bigint") len = Number(lenArg);
                else throw new Error("RAND_NAME len must be a positive integer");
            }
            if (!Number.isInteger(len) || len <= 0) {
                throw new Error("RAND_NAME len must be a positive integer");
            }

            let alphabet = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
            if (alphabetArg !== undefined && alphabetArg !== null) {
                if (typeof alphabetArg === "string") alphabet = alphabetArg;
                else if (alphabetArg?.type === "string") alphabet = alphabetArg.value;
                else throw new Error("RAND_NAME alphabet must be a non-empty string");
            }
            if (typeof alphabet !== "string" || alphabet.length === 0) {
                throw new Error("RAND_NAME alphabet must be a non-empty string");
            }

            let out = "";
            for (let i = 0; i < len; i++) {
                const idx = Math.floor(Math.random() * alphabet.length);
                out += alphabet[idx];
            }
            return { type: "string", value: out };
        },
        doc: "Generate a random name string RAND_NAME(len=10, alphabet=a-zA-Z)",
    },

    // --- I/O ---
    PRINT: {
        impl(args) {
            for (const arg of args) {
                console.log(formatValue(arg));
            }
            return null;
        },
        doc: "Print each argument on a separate line to console",
    },

    DEEPMUTABLE: {
        impl(args) {
            const value = args[0];
            const flag = args[1];  // null (_) → remove ._mutable; anything else → set it
            deepSetMutable(value, flag);
            return value;
        },
        doc: "Recursively set (flag≠_) or remove (flag=_) ._mutable on all nested arrays/maps/tensors. Called via .DeepMutable(value, flag).",
    },
};
