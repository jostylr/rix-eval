/**
 * Function-related system functions: CALL, LAMBDA, FUNCDEF, PATTERNDEF, PIPE
 */

import { Integer } from "@ratmath/core";

export const functionFunctions = {
    CALL: {
        lazy: true,
        impl(args, context, evaluate) {
            // args[0] = function name (string)
            // args[1..] = argument IR nodes
            const name = args[0];
            // Look up the function
            const funcDef = context.get(name);

            if (!funcDef) {
                // FALLBACK: Try evaluating as a system function call (could be lazy)
                try {
                    return evaluate({ fn: name, args: args.slice(1) });
                } catch (e) {
                    if (e.message.startsWith("Unknown system function")) {
                        throw new Error(`Undefined function: ${name}`);
                    }
                    throw e;
                }
            }

            // If it's a user-defined function (FUNCDEF or LAMBDA result)
            if (funcDef.type === "function" || funcDef.type === "lambda") {
                const params = funcDef.params;
                const body = funcDef.body;

                // Evaluate arguments (user functions are NOT lazy by default for now)
                const callArgs = args.slice(1).map((a) => evaluate(a));

                // Create a new scope with parameter bindings
                const scope = new Map();
                if (params && params.positional) {
                    for (let i = 0; i < params.positional.length; i++) {
                        const param = params.positional[i];
                        const value =
                            i < callArgs.length
                                ? callArgs[i]
                                : param.default
                                    ? evaluate(param.default)
                                    : null;
                        scope.set(param.name, value);
                    }
                }

                // Push scope, evaluate body, pop scope
                context.push(scope);
                context.pushCall(name);
                try {
                    const result = evaluate(body);
                    return result;
                } finally {
                    context.popCall();
                    context.pop();
                }
            }

            // If it's a sysref (system function reference)
            if (funcDef.type === "sysref") {
                // Evaluate as system function
                return evaluate({ fn: funcDef.name, args: args.slice(1) });
            }

            // If it's a native JS function (from packages)
            if (typeof funcDef === "function") {
                const callArgs = args.slice(1).map((a) => evaluate(a));
                return funcDef(...callArgs);
            }


            throw new Error(`${name} is not callable`);
        },
        doc: "Call a user-defined or built-in function",
    },

    CALL_EXPR: {
        lazy: true,
        impl(args, context, evaluate) {
            // args[0] = expression that evaluates to a function
            // args[1..] = argument IR nodes
            const funcVal = evaluate(args[0]);
            const callArgs = args.slice(1).map((a) => evaluate(a));

            if (funcVal && (funcVal.type === "function" || funcVal.type === "lambda")) {
                const params = funcVal.params;
                const body = funcVal.body;

                const scope = new Map();
                if (params && params.positional) {
                    for (let i = 0; i < params.positional.length; i++) {
                        const param = params.positional[i];
                        const value =
                            i < callArgs.length
                                ? callArgs[i]
                                : param.default
                                    ? evaluate(param.default)
                                    : null;
                        scope.set(param.name, value);
                    }
                }

                context.push(scope);
                try {
                    return evaluate(body);
                } finally {
                    context.pop();
                }
            }

            if (typeof funcVal === "function") {
                return funcVal(...callArgs);
            }

            throw new Error("Expression is not callable");
        },
        doc: "Call an expression that evaluates to a function",
    },

    LAMBDA: {
        lazy: true,
        impl(args, _context, evaluate) {
            // args[0] = params object { positional, keyword, conditionals, metadata }
            // args[1] = body IR node (kept as IR for deferred evaluation)
            // Evaluate params (to get the structure) but NOT the body
            const params = evaluate(args[0]);
            return {
                type: "lambda",
                params,
                body: args[1],  // Keep as raw IR — will be evaluated when called
            };
        },
        doc: "Create a lambda/anonymous function",
    },

    FUNCDEF: {
        lazy: true,
        impl(args, context, evaluate) {
            // args[0] = function name (string)
            // args[1] = params (pass through)
            // args[2] = body IR node (keep as IR)
            const name = args[0];
            const params = evaluate(args[1]);
            const body = args[2]; // keep as IR, don't evaluate

            const funcDef = {
                type: "function",
                name,
                params,
                body,
            };

            context.defineFunction(name, funcDef);
            return funcDef;
        },
        doc: "Define a named function",
    },

    PATTERNDEF: {
        lazy: true,
        impl(args, context, evaluate) {
            const name = args[0];
            const patterns = evaluate(args[1]);

            const funcDef = {
                type: "pattern_function",
                name,
                patterns,
            };

            context.defineFunction(name, funcDef);
            return funcDef;
        },
        doc: "Define a pattern-matching function",
    },

    PIPE: {
        lazy: true,
        impl(args, context, evaluate) {
            // args[0] = value expression
            // args[1] = function expression
            const value = evaluate(args[0]);
            const funcNode = args[1];

            // If the function is a RETRIEVE or CALL, apply value as first arg
            if (funcNode.fn === "RETRIEVE") {
                const funcName = funcNode.args[0];
                const funcDef = context.get(funcName);

                if (funcDef && (funcDef.type === "function" || funcDef.type === "lambda")) {
                    const scope = new Map();
                    if (funcDef.params?.positional?.length > 0) {
                        scope.set(funcDef.params.positional[0].name, value);
                    }
                    context.push(scope);
                    try {
                        return evaluate(funcDef.body);
                    } finally {
                        context.pop();
                    }
                }
            }

            // If it's a CALL node, prepend value to args
            if (funcNode.fn === "CALL") {
                const name = funcNode.args[0];
                const funcDef = context.get(name);
                const extraArgs = funcNode.args.slice(1).map((a) => evaluate(a));

                if (funcDef && (funcDef.type === "function" || funcDef.type === "lambda")) {
                    const scope = new Map();
                    const allArgs = [value, ...extraArgs];
                    if (funcDef.params?.positional) {
                        for (let i = 0; i < funcDef.params.positional.length; i++) {
                            scope.set(funcDef.params.positional[i].name, allArgs[i] ?? null);
                        }
                    }
                    context.push(scope);
                    try {
                        return evaluate(funcDef.body);
                    } finally {
                        context.pop();
                    }
                }
            }

            // Try evaluating the function and applying
            const func = evaluate(funcNode);
            if (func && (func.type === "function" || func.type === "lambda")) {
                const scope = new Map();
                if (func.params?.positional?.length > 0) {
                    scope.set(func.params.positional[0].name, value);
                }
                context.push(scope);
                try {
                    return evaluate(func.body);
                } finally {
                    context.pop();
                }
            }

            if (typeof func === "function") {
                return func(value);
            }

            throw new Error("Pipe target is not a function");
        },
        doc: "Pipe a value into a function",
    },


    PSLICE_STRICT: {
        lazy: true,
        impl(args, context, evaluate) {
            const collNode = args[0];
            const intervalNode = args[1];

            const coll = evaluate(collNode);
            if (coll === null || coll === undefined) return null;

            const interval = evaluate(intervalNode);
            let i_val, j_val;

            if (interval && interval.constructor && interval.constructor.name === "RationalInterval") {
                i_val = Number(interval.start.numerator) / Number(interval.start.denominator);
                j_val = Number(interval.end.numerator) / Number(interval.end.denominator);
            } else if (interval && interval.type === "interval") {
                const getNum = x => {
                    if (x && x.numerator !== undefined) return Number(x.numerator) / Number(x.denominator);
                    if (x && x.value !== undefined) return Number(x.value);
                    return Number(x);
                };
                i_val = getNum(interval.lo);
                j_val = getNum(interval.hi);
            } else {
                return null;
            }

            if (isNaN(i_val) || isNaN(j_val)) { console.log("ret null 3"); return null; }
            if (!Number.isInteger(i_val) || !Number.isInteger(j_val)) return null;

            let isStringObj = coll && coll.type === "string";
            let isString = typeof coll === "string" || isStringObj;
            let n = 0;
            let items = null;

            if (isString) {
                items = isStringObj ? coll.value : coll;
                n = items.length;
            } else if (coll && Array.isArray(coll.values)) {
                n = coll.values.length;
                items = coll.values;
            } else {
                return null;
            }

            const normalize = (k) => {
                if (k === 0) return null;
                if (k > 0) return k;
                if (k < 0) return n + 1 + k;
                return null;
            };

            let I = normalize(i_val);
            let J = normalize(j_val);

            if (I === null || J === null) return null;

            if (I < 1 || I > n || J < 1 || J > n) return null;

            const indices = [];
            if (I <= J) {
                let start = Math.ceil(I);
                let end = Math.floor(J);
                for (let k = start; k <= end; k++) indices.push(k);
            } else {
                let start = Math.floor(I);
                let end = Math.ceil(J);
                for (let k = start; k >= end; k--) indices.push(k);
            }

            if (isString) {
                let slice = indices.map(idx => items[idx - 1]).join("");
                return isStringObj ? { type: "string", value: slice } : slice;
            } else {
                const results = indices.map(idx => items[idx - 1]);
                if (coll.type === "tuple") {
                    return { type: "tuple", values: results };
                }
                return { type: coll.type || "sequence", values: results };
            }
        },
        doc: "Strict slice operator |>/"
    },

    PSLICE_CLAMP: {
        lazy: true,
        impl(args, context, evaluate) {
            const collNode = args[0];
            const intervalNode = args[1];

            const coll = evaluate(collNode);
            const isStringObj = coll && coll.type === "string";
            const isString = typeof coll === "string" || isStringObj;
            let n = 0;
            let items = null;

            const emptyOutput = isStringObj
                ? { type: "string", value: "" }
                : (isString ? "" : { type: "sequence", values: [] });

            if (coll !== null && coll !== undefined) {
                if (isString) {
                    items = isStringObj ? coll.value : coll;
                    n = items.length;
                } else if (coll && Array.isArray(coll.values)) {
                    n = coll.values.length;
                    items = coll.values;

                    if (coll.type !== "array" && coll.type !== "sequence" && coll.type !== "tuple") {
                        throw new Error("Slicing not supported for this collection type");
                    }
                } else {
                    return emptyOutput;
                }
            } else {
                return emptyOutput;
            }

            const interval = evaluate(intervalNode);
            if (!interval) throw new Error("Invalid interval for clamping");

            let i_val, j_val;
            if (interval && interval.constructor && interval.constructor.name === "RationalInterval") {
                i_val = Number(interval.start.numerator) / Number(interval.start.denominator);
                j_val = Number(interval.end.numerator) / Number(interval.end.denominator);
            } else if (interval && interval.type === "interval") {
                const getNum = x => {
                    if (x && x.numerator !== undefined) return Number(x.numerator) / Number(x.denominator);
                    if (x && x.value !== undefined) return Number(x.value);
                    return Number(x);
                };
                i_val = getNum(interval.lo);
                j_val = getNum(interval.hi);
            } else {
                throw new Error("Invalid interval representation");
            }

            if (isNaN(i_val) || isNaN(j_val)) throw new Error("Interval bounds must be numeric");

            // Handle 0 in clamped mode
            if (i_val === 0 && j_val !== 0) i_val = Math.sign(j_val) * 1;
            if (j_val === 0 && i_val !== 0) j_val = Math.sign(i_val) * 1;
            if (i_val === 0 && j_val === 0) { i_val = 1; j_val = 1; }

            const normalize = (k) => {
                if (k > 0) return k;
                if (k < 0) return n + 1 + k;
                return null;
            };

            let I = normalize(i_val);
            let J = normalize(j_val);

            if (I === null || J === null) return emptyOutput;

            if (n === 0) return emptyOutput;

            if (I < 1) I = 1;
            if (I > n) I = n;
            if (J < 1) J = 1;
            if (J > n) J = n;

            const indices = [];
            if (I <= J) {
                let start = Math.ceil(I);
                let end = Math.floor(J);
                for (let k = start; k <= end; k++) indices.push(k);
            } else {
                let start = Math.floor(I);
                let end = Math.ceil(J);
                for (let k = start; k >= end; k--) indices.push(k);
            }

            if (indices.length === 0) return emptyOutput;

            if (isString) {
                let slice = indices.map(idx => items[idx - 1]).join("");
                return isStringObj ? { type: "string", value: slice } : slice;
            } else {
                const results = indices.map(idx => items[idx - 1]);
                if (coll.type === "tuple") {
                    return { type: "tuple", values: results };
                }
                return { type: coll.type || "sequence", values: results };
            }
        },
        doc: "Clamped slice operator |>//"
    },

    PIPE_EXPLICIT: {
        lazy: true,
        impl(args, context, evaluate) {
            // Same as PIPE for now
            return functionFunctions.PIPE.impl(args, context, evaluate);
        },
        doc: "Explicit pipe operator",
    },

    PMAP: {
        lazy: true,
        impl(args, context, evaluate) {
            const collection = evaluate(args[0]);
            const funcNode = args[1];

            if (!collection || !collection.values) {
                throw new Error("PMAP requires a collection");
            }

            const results = collection.values.map((item) => {
                // Make item available and apply function
                const func = evaluate(funcNode);
                if (func && (func.type === "function" || func.type === "lambda")) {
                    const scope = new Map();
                    if (func.params?.positional?.length > 0) {
                        scope.set(func.params.positional[0].name, item);
                    }
                    context.push(scope);
                    try {
                        return evaluate(func.body);
                    } finally {
                        context.pop();
                    }
                }
                if (typeof func === "function") return func(item);
                throw new Error("PMAP function is not callable");
            });

            return { type: collection.type || "sequence", values: results };
        },
        doc: "Map a function over a collection",
    },

    PFILTER: {
        lazy: true,
        impl(args, context, evaluate) {
            const collection = evaluate(args[0]);
            const funcNode = args[1];

            if (!collection || !collection.values) {
                throw new Error("PFILTER requires a collection");
            }

            const isTruthy = (val) => {
                return val !== null && val !== undefined;
            };

            const results = collection.values.filter((item) => {
                const func = evaluate(funcNode);
                if (func && (func.type === "function" || func.type === "lambda")) {
                    const scope = new Map();
                    if (func.params?.positional?.length > 0) {
                        scope.set(func.params.positional[0].name, item);
                    }
                    context.push(scope);
                    try {
                        return isTruthy(evaluate(func.body));
                    } finally {
                        context.pop();
                    }
                }
                if (typeof func === "function") return isTruthy(func(item));
                throw new Error("PFILTER function is not callable");
            });

            return { type: collection.type || "sequence", values: results };
        },
        doc: "Filter a collection with a predicate",
    },

    PREDUCE: {
        lazy: true,
        impl(args, context, evaluate) {
            const collection = evaluate(args[0]);
            const funcNode = args[1];
            const init = args.length > 2 ? evaluate(args[2]) : null;

            if (!collection || !collection.values) {
                throw new Error("PREDUCE requires a collection");
            }

            const func = evaluate(funcNode);
            let acc = init ?? collection.values[0];
            const startIdx = init !== null ? 0 : 1;

            for (let i = startIdx; i < collection.values.length; i++) {
                if (func && (func.type === "function" || func.type === "lambda")) {
                    const scope = new Map();
                    if (func.params?.positional?.length >= 2) {
                        scope.set(func.params.positional[0].name, acc);
                        scope.set(func.params.positional[1].name, collection.values[i]);
                    }
                    context.push(scope);
                    try {
                        acc = evaluate(func.body);
                    } finally {
                        context.pop();
                    }
                } else if (typeof func === "function") {
                    acc = func(acc, collection.values[i]);
                } else {
                    throw new Error("PREDUCE function is not callable");
                }
            }

            return acc;
        },
        doc: "Reduce a collection with an accumulator function",
    },

    PREVERSE: {
        impl(args) {
            const collection = args[0];
            if (!collection || !collection.values) {
                throw new Error("PREVERSE requires a collection");
            }
            return { type: collection.type || "sequence", values: [...collection.values].reverse() };
        },
        pure: true,
        doc: "Reverse a collection (returns new copy)",
    },

    PSORT: {
        lazy: true,
        impl(args, context, evaluate) {
            const collection = evaluate(args[0]);
            const funcNode = args[1];

            if (!collection || !collection.values) {
                throw new Error("PSORT requires a collection");
            }

            const func = evaluate(funcNode);
            const sorted = [...collection.values].sort((a, b) => {
                if (func && (func.type === "function" || func.type === "lambda")) {
                    const scope = new Map();
                    if (func.params?.positional?.length >= 2) {
                        scope.set(func.params.positional[0].name, a);
                        scope.set(func.params.positional[1].name, b);
                    }
                    context.push(scope);
                    try {
                        const result = evaluate(func.body);
                        if (result instanceof Integer) return Number(result.value);
                        if (typeof result === "number") return result;
                        return 0;
                    } finally {
                        context.pop();
                    }
                }
                if (typeof func === "function") {
                    const result = func(a, b);
                    return typeof result === "number" ? result : 0;
                }
                // Default: numeric sort
                const na = a instanceof Integer ? Number(a.value) : Number(a);
                const nb = b instanceof Integer ? Number(b.value) : Number(b);
                return na - nb;
            });

            return { type: collection.type || "sequence", values: sorted };
        },
        doc: "Sort a collection with comparator function (returns new copy)",
    },

    PALL: {
        lazy: true,
        impl(args, context, evaluate) {
            const collection = evaluate(args[0]);
            const funcNode = args[1];

            if (!collection || !collection.values) {
                throw new Error("PALL requires a collection");
            }

            if (collection.values.length === 0) {
                return null;
            }

            let lastItem = null;
            for (const item of collection.values) {
                const func = evaluate(funcNode);
                let result;
                if (func && (func.type === "function" || func.type === "lambda")) {
                    const scope = new Map();
                    if (func.params?.positional?.length > 0) {
                        scope.set(func.params.positional[0].name, item);
                    }
                    context.push(scope);
                    try {
                        result = evaluate(func.body);
                    } finally {
                        context.pop();
                    }
                } else if (typeof func === "function") {
                    result = func(item);
                } else {
                    throw new Error("PALL function is not callable");
                }
                if (result === null || result === undefined) return null;
                lastItem = item;
            }
            return lastItem;
        },
        doc: "Every: returns the last element if predicate is truthy for ALL elements, null on first failure",
    },

    PANY: {
        lazy: true,
        impl(args, context, evaluate) {
            const collection = evaluate(args[0]);
            const funcNode = args[1];

            if (!collection || !collection.values) {
                console.log("PANY collection:", collection, "args:", args); throw new Error("PANY requires a collection");
            }

            for (const item of collection.values) {
                const func = evaluate(funcNode);
                let result;
                if (func && (func.type === "function" || func.type === "lambda")) {
                    const scope = new Map();
                    if (func.params?.positional?.length > 0) {
                        scope.set(func.params.positional[0].name, item);
                    }
                    context.push(scope);
                    try {
                        result = evaluate(func.body);
                    } finally {
                        context.pop();
                    }
                } else if (typeof func === "function") {
                    result = func(item);
                } else {
                    throw new Error("PANY function is not callable");
                }
                if (result !== null && result !== undefined) return item;
            }
            return null;
        },
        doc: "Any: returns first item that passed predicate, null if none pass",
    },

    KWARG: {
        impl(args) {
            // Keyword argument: just return a tagged pair
            return { type: "kwarg", name: args[0], value: args[1] };
        },
        pure: true,
        doc: "Keyword argument wrapper",
    },
};
