/**
 * Collection system functions: ARRAY, SET, MAP, TUPLE, INTERVAL
 */

import { Integer, Rational, RationalInterval } from "@ratmath/core";

function isTruthy(val) {
    return val !== null && val !== undefined;
}

function valueKey(val) {
    if (val === null || val === undefined) return "null";
    if (typeof val === "object") {
        if (typeof val.toString === "function" && val.toString !== Object.prototype.toString) {
            return val.toString();
        }
        if (val.type) {
            if (val.type === "tuple" || val.type === "sequence" || val.type === "set" || val.type === "array") {
                const vals = val.values || val.elements || [];
                return `${val.type}[${vals.map(valueKey).join(",")}]`;
            }
            if (val.type === "string") return JSON.stringify(val.value);
            return JSON.stringify(val, (k, v) => typeof v === 'bigint' ? v.toString() : v);
        }
    }
    return String(val);
}

const getValues = (arg) => {
    if (arg && typeof arg === 'object') {
        if (arg.type === "set" && Array.isArray(arg.values)) {
            return arg.values;
        }
        if (arg instanceof RationalInterval) {
            return [arg.start, arg.end];
        }
        if (arg.type === "interval") {
            return [arg.lo, arg.hi];
        }
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

const classifyUnionIntersectDomain = (val) => {
    if (val && typeof val === "object") {
        if (val.type === "set") return "set";
        if (val instanceof RationalInterval || val.type === "interval") return "interval";
    }
    return null;
};

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
                const key = valueKey(val);
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

    MAP_OBJ: {
        lazy: true,
        impl(args, context, evaluate) {
            // MAP args come in as lowered elements
            // For {= a=3, b=6 }, the lowered form has assignment IR nodes
            // We store as key-value pairs
            const entries = new Map();
            for (const arg of args) {
                if (arg && arg.fn === "ASSIGN") {
                    // Extract name and evaluate the value
                    const name = arg.args[0];
                    const val = evaluate(arg.args[1]);
                    entries.set(name, val);
                } else if (arg && arg.fn === "KWARG") {
                    // Keyword args also used in MAP literals sometimes
                    const name = arg.args[0];
                    const val = evaluate(arg.args[1]);
                    entries.set(name, val);
                } else {
                    // Single-value entry: evaluate and use index/value as key
                    const val = evaluate(arg);
                    entries.set(val?.toString?.() ?? String(args.indexOf(arg)), val);
                }
            }
            return { type: "map", entries };
        },
        pure: true, // It might not be pure if evaluate calls non-pure functions, but usually for literals it's okay.
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

    MEMBER: {
        impl(args) {
            const [x, coll] = args;
            if (!coll || typeof coll !== "object") return null;

            if (coll.type === "set" || coll.type === "tuple" || coll.type === "sequence") {
                const values = coll.values || coll.elements || [];
                const xKey = valueKey(x);
                for (const v of values) {
                    if (valueKey(v) === xKey) return new Integer(1);
                }
            } else if (coll instanceof RationalInterval || coll.type === "interval") {
                // Interval membership check using compare logic from INTERVAL
                // Actually INTERVAL already has logic for this if we pass x:lo:hi
                // But let's implement it directly for simplicity/performance
                const lo = coll instanceof RationalInterval ? coll.start : coll.lo;
                const hi = coll instanceof RationalInterval ? coll.end : coll.hi;

                const cmpLo = compare(lo, x);
                const cmpHi = compare(x, hi);

                if (cmpLo <= 0 && cmpHi <= 0) return new Integer(1);
            } else if (coll.type === "map") {
                const entries = coll.entries || coll.elements || new Map();
                if (entries.has(x) || entries.has(valueKey(x))) return new Integer(1);
            }
            return null;
        },
        pure: true,
        doc: "Check membership (1 if present, null otherwise)",
    },

    NOT_MEMBER: {
        impl(args) {
            return isTruthy(collectionFunctions.MEMBER.impl(args)) ? null : new Integer(1);
        },
        pure: true,
        doc: "Check non-membership (1 if not present, null otherwise)",
    },

    INTERSECTS: {
        impl(args) {
            const [a, b] = args;
            const intersect = collectionFunctions.INTERSECT.impl([a, b]);
            return isTruthy(intersect) ? new Integer(1) : null;
        },
        pure: true,
        doc: "Check if two collections intersect (1 if true, null otherwise)",
    },

    UNION: {
        impl(args) {
            const [a, b] = args;
            if (!a || !b) return null;

            if (a.type === "set" && b.type === "set") {
                const seen = new Set();
                const values = [];
                for (const v of [...a.values, ...b.values]) {
                    const key = valueKey(v);
                    if (!seen.has(key)) {
                        seen.add(key);
                        values.push(v);
                    }
                }
                return { type: "set", values };
            }

            if ((a instanceof RationalInterval || a.type === "interval") &&
                (b instanceof RationalInterval || b.type === "interval")) {
                // Interval hull
                const alo = a instanceof RationalInterval ? a.start : a.lo;
                const ahi = a instanceof RationalInterval ? a.end : a.hi;
                const blo = b instanceof RationalInterval ? b.start : b.lo;
                const bhi = b instanceof RationalInterval ? b.end : b.hi;

                const lo = compare(alo, blo) <= 0 ? alo : blo;
                const hi = compare(ahi, bhi) >= 0 ? ahi : bhi;

                return collectionFunctions.INTERVAL.impl([lo, hi]);
            }

            throw new Error(`UNION not defined for these types: ${a.type || a.constructor.name} and ${b.type || b.constructor.name}`);
        },
        pure: true,
        doc: "Join/Union of two collections (set union or interval hull)",
    },

    INTERSECT: {
        impl(args) {
            const [a, b] = args;
            if (!a || !b) return null;

            if (a.type === "set" && b.type === "set") {
                const bValues = b.values.map(valueKey);
                const values = a.values.filter(v => bValues.includes(valueKey(v)));
                return { type: "set", values };
            }

            if ((a instanceof RationalInterval || a.type === "interval") &&
                (b instanceof RationalInterval || b.type === "interval")) {
                const alo = a instanceof RationalInterval ? a.start : a.lo;
                const ahi = a instanceof RationalInterval ? a.end : a.hi;
                const blo = b instanceof RationalInterval ? b.start : b.lo;
                const bhi = b instanceof RationalInterval ? b.end : b.hi;

                const lo = compare(alo, blo) >= 0 ? alo : blo;
                const hi = compare(ahi, bhi) <= 0 ? ahi : bhi;

                if (compare(lo, hi) <= 0) {
                    return collectionFunctions.INTERVAL.impl([lo, hi]);
                }
                return null;
            }

            return null;
        },
        pure: true,
        doc: "Intersection of two collections (set intersection or interval overlap)",
    },

    NARY_UNION: {
        impl(args) {
            if (args.length === 0) return { type: "set", values: [] };
            if (args.length === 1) return args[0];

            const domain = classifyUnionIntersectDomain(args[0]);
            if (!domain) {
                throw new Error("NARY_UNION expects sets or intervals");
            }
            for (let i = 1; i < args.length; i++) {
                if (classifyUnionIntersectDomain(args[i]) !== domain) {
                    throw new Error("NARY_UNION operands must all be sets or all be intervals");
                }
            }

            let acc = args[0];
            for (let i = 1; i < args.length; i++) {
                acc = collectionFunctions.UNION.impl([acc, args[i]]);
            }
            return acc;
        },
        pure: true,
        doc: "N-ary union/hull fold for sets or intervals",
    },

    NARY_INTERSECT: {
        impl(args) {
            if (args.length === 0) return { type: "set", values: [] };
            if (args.length === 1) return args[0];

            const domain = classifyUnionIntersectDomain(args[0]);
            if (!domain) {
                throw new Error("NARY_INTERSECT expects sets or intervals");
            }
            for (let i = 1; i < args.length; i++) {
                if (classifyUnionIntersectDomain(args[i]) !== domain) {
                    throw new Error("NARY_INTERSECT operands must all be sets or all be intervals");
                }
            }

            let acc = args[0];
            for (let i = 1; i < args.length; i++) {
                acc = collectionFunctions.INTERSECT.impl([acc, args[i]]);
                if (acc === null) return null;
            }
            return acc;
        },
        pure: true,
        doc: "N-ary intersection/overlap fold for sets or intervals",
    },

    SET_DIFF: {
        impl(args) {
            const [a, b] = args;
            if (a.type === "set" && b.type === "set") {
                const bValues = b.values.map(valueKey);
                const values = a.values.filter(v => !bValues.includes(valueKey(v)));
                return { type: "set", values };
            }
            if (a.type === "map") {
                // If b is set of keys or single key, remove them
                const newEntries = new Map(a.entries);
                if (b.type === "set") {
                    for (const k of b.values) newEntries.delete(valueKey(k));
                } else {
                    newEntries.delete(valueKey(b));
                    newEntries.delete(b);
                }
                return { type: "map", entries: newEntries };
            }
            throw new Error("Difference only defined for sets and maps");
        },
        pure: true,
    },

    SET_SYMDIFF: {
        impl(args) {
            const [a, b] = args;
            const diff1 = collectionFunctions.SET_DIFF.impl([a, b]);
            const diff2 = collectionFunctions.SET_DIFF.impl([b, a]);
            return collectionFunctions.UNION.impl([diff1, diff2]);
        },
        pure: true,
    },

    SET_PROD: {
        impl(args) {
            const [a, b] = args;
            if (a.type !== "set" || b.type !== "set") throw new Error("Cartesian product only for sets");
            const values = [];
            for (const va of a.values) {
                for (const vb of b.values) {
                    values.push({ type: "tuple", values: [va, vb] });
                }
            }
            return { type: "set", values };
        },
        pure: true,
    },

    CONCAT: {
        impl(args) {
            const [a, b] = args;
            if (a.type === "string" || b.type === "string") {
                const getStr = (v) => (v && typeof v === 'object' && v.type === "string") ? v.value : String(v);
                return { type: "string", value: getStr(a) + getStr(b) };
            }
            if (a.type === "sequence" || a.type === "tuple" || a.type === "array" ||
                b.type === "sequence" || b.type === "tuple" || b.type === "array") {
                const getVals = (v) => v.values || v.elements || (Array.isArray(v) ? v : [v]);
                const vals = [...getVals(a), ...getVals(b)];
                // If either is array/sequence, result is sequence. If both are tuples, result is tuple.
                if (a.type === "tuple" && b.type === "tuple") return { type: "tuple", values: vals };
                return { type: "sequence", values: vals };
            }
            if (a.type === "map" && b.type === "map") {
                return { type: "map", entries: new Map([...a.entries, ...b.entries]) };
            }
            throw new Error("Concatenation not defined for these types");
        },
        pure: true,
    },

    NARY_CONCAT: {
        impl(args) {
            if (args.length === 0) {
                throw new Error("NARY_CONCAT requires at least one argument");
            }
            if (args.length === 1) return args[0];

            let acc = args[0];
            for (let i = 1; i < args.length; i++) {
                acc = collectionFunctions.CONCAT.impl([acc, args[i]]);
            }
            return acc;
        },
        pure: true,
        doc: "N-ary concatenation fold",
    },
};
