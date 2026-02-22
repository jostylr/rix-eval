/**
 * Collection system functions: ARRAY, SET, MAP, TUPLE, INTERVAL
 */

import { Integer, Rational, RationalInterval } from "@ratmath/core";

export const collectionFunctions = {
    ARRAY: {
        lazy: true,
        impl(args, ctx, evaluate) {
            const values = [];
            let i = 0;
            while (i < args.length) {
                const arg = args[i];
                if (arg && arg.fn === "GENERATOR") {
                    let current = arg.args[0] ? evaluate(arg.args[0]) : values[values.length - 1];
                    if (current === undefined) throw new Error("Sequence generator missing start value");
                    if (arg.args[0]) values.push(current);

                    const ops = [...arg.args.slice(1)];
                    // Consume subsequent GENERATOR nodes
                    while (i + 1 < args.length && args[i + 1] && args[i + 1].fn === "GENERATOR") {
                        i++;
                        ops.push(...args[i].args.slice(1));
                    }

                    let generate = true;
                    let maxEager = 10000;

                    while (generate && maxEager-- > 0) {
                        let next = current;
                        let stop = false;
                        for (const op of ops) {
                            if (!op || typeof op !== 'object') continue;
                            const opArg = op.args?.[0] ? evaluate(op.args[0]) : null;
                            if (op.fn === "GEN_ADD") {
                                next = evaluate({ fn: "ADD", args: [next, opArg] });
                            } else if (op.fn === "GEN_MUL") {
                                next = evaluate({ fn: "MUL", args: [next, opArg] });
                            } else if (op.fn === "GEN_EAGER_LIMIT") {
                                if (values.length >= opArg) stop = true;
                            } else if (op.fn === "GEN_LIMIT") {
                                const gtResult = evaluate({ fn: "GT", args: [next, opArg] });
                                if (gtResult !== null && gtResult !== undefined) stop = true;
                            }
                        }
                        if (stop) break;
                        values.push(next);
                        current = next;
                    }
                } else {
                    values.push(evaluate(arg));
                }
                i++;
            }
            return { type: "sequence", values };
        },
        pure: true,
        doc: "Create an array/sequence (supports sequence generators)",
    },

    TUPLE: {
        impl(args) {
            return { type: "tuple", values: args };
        },
        pure: true,
        doc: "Create a tuple",
    },

    SET: {
        impl(args) {
            // Deduplicate (using toString for comparison)
            const seen = new Set();
            const values = [];
            for (const val of args) {
                const key = val?.toString?.() ?? String(val);
                if (!seen.has(key)) {
                    seen.add(key);
                    values.push(val);
                }
            }
            return { type: "set", values };
        },
        pure: true,
        doc: "Create a set (unique values)",
    },

    MAP: {
        impl(args) {
            // MAP args come in as lowered elements
            // For {= a=3, b=6 }, the lowered form has assignment IR nodes
            // We store as key-value pairs
            const entries = new Map();
            for (const arg of args) {
                if (arg && arg.fn === "ASSIGN") {
                    // During evaluation, ASSIGN args will have been evaluated
                    // but for MAP we treat them as key-value pairs
                    entries.set(arg.args?.[0], arg.args?.[1]);
                } else if (Array.isArray(arg) && arg.length === 2) {
                    entries.set(arg[0], arg[1]);
                } else {
                    // Single-value entry
                    entries.set(arg?.toString?.() ?? String(args.indexOf(arg)), arg);
                }
            }
            return { type: "map", entries };
        },
        pure: true,
        doc: "Create a map/object",
    },

    INTERVAL: {
        impl(args) {
            if (args.length === 2) {
                const lo = args[0];
                const hi = args[1];

                // Try to create a proper RationalInterval if both are ratmath types
                try {
                    let loRat, hiRat;
                    if (lo instanceof Integer) {
                        loRat = new Rational(lo.value, 1n);
                    } else if (lo instanceof Rational) {
                        loRat = lo;
                    }

                    if (hi instanceof Integer) {
                        hiRat = new Rational(hi.value, 1n);
                    } else if (hi instanceof Rational) {
                        hiRat = hi;
                    }

                    if (loRat && hiRat) {
                        return new RationalInterval(loRat, hiRat);
                    }
                } catch {
                    // Fall through to generic
                }

                return { type: "interval", lo, hi };
            }

            // Betweenness check for 3 or more arguments
            const getValues = (arg) => {
                if (arg && arg.type === "set" && Array.isArray(arg.values)) {
                    return arg.values;
                }
                return [arg];
            };

            const compare = (a, b) => {
                let aRat, bRat;
                try {
                    if (a && typeof a === 'object' && a.constructor.name === 'Integer') {
                        aRat = new Rational(a.value, 1n);
                    } else if (a instanceof Rational) {
                        aRat = a;
                    } else if (typeof a === 'number' || typeof a === 'bigint' || typeof a === 'string') {
                        aRat = new Rational(a);
                    }

                    if (b && typeof b === 'object' && b.constructor.name === 'Integer') {
                        bRat = new Rational(b.value, 1n);
                    } else if (b instanceof Rational) {
                        bRat = b;
                    } else if (typeof b === 'number' || typeof b === 'bigint' || typeof b === 'string') {
                        bRat = new Rational(b);
                    }

                    if (aRat && bRat) {
                        return aRat.compareTo(bRat);
                    }
                } catch {
                    // Fallback to JS comparison below
                }
                if (a < b) return -1;
                if (a > b) return 1;
                return 0;
            };

            let allAscending = true;
            let allDescending = true;

            const checkPaths = (idx, currentVal, direction) => {
                if (idx === args.length) return true;

                const nextVals = getValues(args[idx]);
                for (const nextVal of nextVals) {
                    const cmp = compare(currentVal, nextVal);
                    if (direction === 1 && cmp > 0) return false;
                    if (direction === -1 && cmp < 0) return false;

                    if (!checkPaths(idx + 1, nextVal, direction)) {
                        return false;
                    }
                }
                return true;
            };

            const firstVals = getValues(args[0]);

            for (const firstVal of firstVals) {
                if (allAscending && !checkPaths(1, firstVal, 1)) {
                    allAscending = false;
                }
                if (allDescending && !checkPaths(1, firstVal, -1)) {
                    allDescending = false;
                }
                if (!allAscending && !allDescending) break;
            }

            if (allAscending || allDescending) {
                return new Integer(1);
            }
            return null;
        },
        pure: true,
        doc: "Create an interval [lo, hi] or test betweenness like a:b:c",
    },
};
