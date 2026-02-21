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
                if (val instanceof Integer) return val.value !== 0n;
                return Boolean(val);
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

    KWARG: {
        impl(args) {
            // Keyword argument: just return a tagged pair
            return { type: "kwarg", name: args[0], value: args[1] };
        },
        pure: true,
        doc: "Keyword argument wrapper",
    },
};
