/**
 * Function-related system functions: CALL, LAMBDA, FUNCDEF, PATTERNDEF, PIPE
 */

import { Integer, Rational } from "@ratmath/core";
import { keyOf } from "./keyof.js";

const isTruthy = (val) => val !== null && val !== undefined;

// --- Partial Application Helpers ---

/**
 * True if a raw IR node (unevaluated arg) is a PLACEHOLDER.
 */
function isPlaceholderNode(node) {
    return node && typeof node === "object" && node.fn === "PLACEHOLDER";
}

/**
 * Apply a partial to concrete call args.
 * Placeholders _N are replaced by callArgs[N-1]; extra args are appended.
 */
function resolvePartial(partial, callArgs) {
    const { fn, template } = partial;
    const filled = template.map(t =>
        (t && t.type === "placeholder") ? callArgs[t.index - 1] : t
    );
    const maxIdx = template.reduce(
        (max, t) => (t && t.type === "placeholder") ? Math.max(max, t.index) : max,
        0
    );
    return { fn, args: [...filled, ...callArgs.slice(maxIdx)] };
}

/**
 * Call a resolved function value (function/lambda/sysref/partial/native) with
 * concrete (already-evaluated) args.
 */
function callWithConcreteArgs(fn, callArgs, context, evaluate) {
    if (!fn) throw new Error("Cannot call null/undefined");

    if (fn.type === "arityCap") {
        return callWithConcreteArgs(fn.fn, callArgs.slice(0, fn.cap), context, evaluate);
    }

    if (fn.type === "partial") {
        const { fn: innerFn, args } = resolvePartial(fn, callArgs);
        return callWithConcreteArgs(innerFn, args, context, evaluate);
    }

    if (fn.type === "function" || fn.type === "lambda") {
        const scope = new Map();
        if (fn.params?.positional) {
            for (let i = 0; i < fn.params.positional.length; i++) {
                const param = fn.params.positional[i];
                scope.set(param.name, i < callArgs.length
                    ? callArgs[i]
                    : (param.default ? evaluate(param.default) : null));
            }
        }
        context.push(scope);
        if (fn.name) context.pushCall(fn.name);
        try {
            return context.withSharedBody(fn.body, () => evaluate(fn.body));
        } finally {
            if (fn.name) context.popCall();
            context.pop();
        }
    }

    // System function reference — concrete values have no .fn so they pass
    // through evaluate() unchanged, whether the sysref is lazy or not.
    if (fn.type === "sysref") {
        return evaluate({ fn: fn.name, args: callArgs });
    }

    if (typeof fn === "function") {
        return fn(...callArgs);
    }

    throw new Error("Value is not callable");
}

/**
 * Invoke a traversal or reduce callback with a locator-aware argument list.
 *
 * For traversal pipes (map/filter/all/any/split-pred/chunk-pred):
 *   callArgs = [val, locator, src]
 *
 * For reduce:
 *   callArgs = [acc, val, locator, src]
 *
 * Locator is the native indexing/key form for the source collection:
 *   - sequences/strings: 1-based Integer position
 *   - maps: { type: "string", value: canonicalKey }
 *   - tensors (future): index tuple
 *
 * Backward compatibility: functions/lambdas bind only declared parameters,
 * so extra args (locator, src) are silently ignored by callbacks that do not
 * declare them.  Partials append extra args beyond placeholders, and the
 * underlying operator simply ignores them.
 */
function invokeTraversalCallback(func, callArgs, context, evaluate) {
    if (func && func.type === "arityCap") {
        return invokeTraversalCallback(func.fn, callArgs.slice(0, func.cap), context, evaluate);
    }
    if (func && func.type === "partial") {
        // For partials, pass only as many args as needed to fill the placeholder slots.
        // This prevents locator/src from leaking into N-ary system functions (ADD, MUL, etc.)
        // that iterate over all received arguments and would fail on non-numeric values.
        // User-accessible locator/src in a partial: use _2/_3 placeholders explicitly.
        const maxIdx = func.template.reduce(
            (max, t) => (t && t.type === "placeholder") ? Math.max(max, t.index) : max, 0
        );
        return callWithConcreteArgs(func, callArgs.slice(0, maxIdx), context, evaluate);
    }
    if (func && func.type === "sysref") {
        return evaluate({ fn: func.name, args: callArgs });
    }
    if (func && (func.type === "function" || func.type === "lambda")) {
        const scope = new Map();
        if (func.params?.positional) {
            for (let i = 0; i < func.params.positional.length; i++) {
                scope.set(func.params.positional[i].name,
                    i < callArgs.length ? callArgs[i] : null);
            }
        }
        context.push(scope);
        try {
            return evaluate(func.body);
        } finally {
            context.pop();
        }
    }
    if (typeof func === "function") {
        return func(...callArgs);
    }
    throw new Error("Callback is not callable");
}

export const functionFunctions = {
    CALL: {
        lazy: true,
        impl(args, context, evaluate) {
            // args[0] = function name (string)
            // args[1..] = argument IR nodes
            const name = args[0];
            const argNodes = args.slice(1);

            // If any arg is a placeholder, build a partial application instead.
            if (argNodes.some(isPlaceholderNode)) {
                const template = argNodes.map(a => evaluate(a));
                const funcDef = context.getCallable(name);
                const fn = funcDef || { type: "sysref", name };
                return { type: "partial", fn, template };
            }

            // Look up the function
            const funcDef = context.getCallable(name);

            if (!funcDef) {
                throw new Error(`Undefined identifier: ${name}. System capabilities must be called via dot syntax: .${name}(args)`);
            }

            // If it's a partial or arityCap, apply it with the concrete call args.
            if (funcDef.type === "partial" || funcDef.type === "arityCap") {
                const callArgs = argNodes.map(a => evaluate(a));
                return callWithConcreteArgs(funcDef, callArgs, context, evaluate);
            }

            // If it's a user-defined function (FUNCDEF or LAMBDA result)
            if (funcDef.type === "function" || funcDef.type === "lambda") {
                const params = funcDef.params;
                const body = funcDef.body;

                // Evaluate arguments (user functions are NOT lazy by default for now)
                const callArgs = argNodes.map((a) => evaluate(a));

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
                    const result = context.withSharedBody(body, () => evaluate(body));
                    return result;
                } finally {
                    context.popCall();
                    context.pop();
                }
            }

            // If it's a sysref (system function reference)
            if (funcDef.type === "sysref") {
                // Evaluate as system function
                return evaluate({ fn: funcDef.name, args: argNodes });
            }

            // If it's a native JS function (from packages)
            if (typeof funcDef === "function") {
                const callArgs = argNodes.map((a) => evaluate(a));
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
            const funcNode = args[0];
            const argNodes = args.slice(1);

            // If any arg is a placeholder, build a partial application.
            if (argNodes.some(isPlaceholderNode)) {
                const funcVal = evaluate(funcNode);
                const template = argNodes.map(a => evaluate(a));
                return { type: "partial", fn: funcVal, template };
            }

            const funcVal = evaluate(funcNode);
            const callArgs = argNodes.map((a) => evaluate(a));

            // If it's a partial or arityCap, apply it.
            if (funcVal && (funcVal.type === "partial" || funcVal.type === "arityCap")) {
                return callWithConcreteArgs(funcVal, callArgs, context, evaluate);
            }

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
                    return context.withSharedBody(body, () => evaluate(body));
                } finally {
                    context.pop();
                }
            }

            if (funcVal && funcVal.type === "sysref") {
                return evaluate({ fn: funcVal.name, args: callArgs });
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

            // Tuples are unpacked as positional args; all other values are a single arg
            const callArgs = (value && value.type === "tuple")
                ? value.values
                : [value];

            // If the function is a RETRIEVE or CALL, apply unpacked args
            if (funcNode.fn === "RETRIEVE") {
                const funcName = funcNode.args[0];
                const funcDef = context.getCallable(funcName);

                if (funcDef && (funcDef.type === "function" || funcDef.type === "lambda")) {
                    return callWithConcreteArgs(funcDef, callArgs, context, evaluate);
                }
            }

            // If it's a CALL node, prepend unpacked args before extra args
            if (funcNode.fn === "CALL") {
                const name = funcNode.args[0];
                const funcDef = context.getCallable(name);
                const extraArgs = funcNode.args.slice(1).map((a) => evaluate(a));

                if (funcDef && (funcDef.type === "function" || funcDef.type === "lambda")) {
                    return callWithConcreteArgs(funcDef, [...callArgs, ...extraArgs], context, evaluate);
                }
            }

            // Try evaluating the function and applying
            const func = evaluate(funcNode);

            if (func && (func.type === "partial" || func.type === "arityCap")) {
                return callWithConcreteArgs(func, callArgs, context, evaluate);
            }

            if (func && func.type === "sysref") {
                return evaluate({ fn: func.name, args: callArgs });
            }

            if (func && (func.type === "function" || func.type === "lambda")) {
                return callWithConcreteArgs(func, callArgs, context, evaluate);
            }

            if (typeof func === "function") {
                return func(...callArgs);
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
                items = Array.from(items);
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
                    items = Array.from(items);
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
            // args[0] = left value expression (typically a tuple)
            // args[1] = right expression: a function call containing PLACEHOLDER nodes
            //           e.g. F(_2, _1) — placeholders refer to tuple elements by 1-based index
            const value = evaluate(args[0]);
            const tupleVals = (value && value.type === "tuple") ? value.values : [value];
            const funcNode = args[1];

            // Walk a raw IR node, replacing PLACEHOLDER nodes with the corresponding
            // tuple element value (already evaluated), leaving everything else intact.
            // _0 refers to the whole tuple as a single value; _1, _2, … are 1-based elements.
            function resolvePlaceholders(node) {
                if (!node || typeof node !== "object") return node;
                if (node.fn === "PLACEHOLDER") {
                    const idx = node.args[0];
                    if (idx === 0) return value; // _0 = the whole left-hand value
                    if (idx < 1 || idx > tupleVals.length) {
                        throw new Error(`Placeholder _${idx} out of range (tuple has ${tupleVals.length} element${tupleVals.length === 1 ? "" : "s"})`);
                    }
                    return tupleVals[idx - 1];
                }
                if (node.fn && Array.isArray(node.args)) {
                    return { fn: node.fn, args: node.args.map(resolvePlaceholders) };
                }
                return node;
            }

            const resolvedFuncNode = resolvePlaceholders(funcNode);
            return evaluate(resolvedFuncNode);
        },
        doc: "Explicit pipe operator — placeholders _1, _2, … map tuple elements to specific argument positions",
    },

    PSPLIT: {
        lazy: true,
        impl(args, context, evaluate) {
            const collection = evaluate(args[0]);
            const sepNode = args[1];

            if (collection === null || collection === undefined) {
                return null;
            }

            // Maps have no defined order and are not supported by split.
            if (collection.type === "map") {
                throw new Error("PSPLIT does not support maps — maps have no defined order");
            }

            const isStringObj = collection && collection.type === "string";
            const isString = typeof collection === "string" || isStringObj;
            let items = null;

            if (isString) {
                items = Array.from(isStringObj ? collection.value : collection).map(ch => isStringObj ? { type: "string", value: ch } : ch);
            } else if (collection && Array.isArray(collection.values)) {
                items = collection.values;
            } else {
                return null; // or throw
            }

            const sepVal = evaluate(sepNode);
            const results = [];

            // Check if sepVal is a regex function
            const isRegex = typeof sepVal === "function" && sepVal.toString && sepVal.toString().startsWith("[Regex");

            const isFunc = !isRegex && (
                (sepVal && (sepVal.type === "function" || sepVal.type === "lambda")) ||
                typeof sepVal === "function"
            );

            if (isString && isRegex) {
                const strItems = items.map(r => r && r.type === "string" ? r.value : r).join("");
                const matchStr = sepVal.toString().match(/{\/(.*)\/([^}]*)}/);
                if (!matchStr) throw new Error("Invalid regex for splitting");
                const pattern = matchStr[1];
                let flags = matchStr[2];
                if (!flags.includes("g")) flags += "g";

                let re;
                try {
                    re = new RegExp(pattern, flags);
                } catch (e) { throw new Error(e); }

                let lastIdx = 0;
                let m;
                // Important: `expect u flag for unicode` handled by user if they specified it.
                while ((m = re.exec(strItems)) !== null) {
                    results.push(Array.from(strItems.slice(lastIdx, m.index)).map(ch => isStringObj ? { type: "string", value: ch } : ch));
                    lastIdx = re.lastIndex;
                    if (m[0].length === 0) re.lastIndex++; // no infinite loops
                }
                results.push(Array.from(strItems.slice(lastIdx)).map(ch => isStringObj ? { type: "string", value: ch } : ch));
            }
            else if (isFunc) {
                let currentPiece = [];
                let inSeparator = false;

                // Predicate receives (val, locator, src) where locator is 1-based Integer position.
                for (let i = 0; i < items.length; i++) {
                    const item = items[i];
                    const loc = new Integer(BigInt(i + 1));
                    const isSep = isTruthy(invokeTraversalCallback(sepVal, [item, loc, collection], context, evaluate));

                    if (isSep) {
                        if (!inSeparator) {
                            results.push(currentPiece);
                            currentPiece = [];
                            inSeparator = true;
                        }
                    } else {
                        if (inSeparator) {
                            inSeparator = false;
                        }
                        currentPiece.push(item);
                    }
                }
                results.push(currentPiece);
            } else {
                if (isString) {
                    const sepStrVal = sepVal && sepVal.type === "string" ? sepVal.value : String(typeof sepVal === "object" && sepVal?.constructor?.name === "Integer" ? sepVal.value : sepVal);
                    const sepItems = Array.from(sepStrVal);

                    let currentPiece = [];
                    for (let i = 0; i < items.length;) {
                        let match = true;
                        if (sepItems.length > 0 && i + sepItems.length <= items.length) {
                            for (let j = 0; j < sepItems.length; j++) {
                                const val = items[i + j] && items[i + j].type === "string" ? items[i + j].value : items[i + j];
                                if (val !== sepItems[j]) {
                                    match = false; break;
                                }
                            }
                        } else {
                            match = false;
                        }

                        if (match && sepItems.length > 0) {
                            results.push(currentPiece);
                            currentPiece = [];
                            i += sepItems.length;
                        } else if (sepItems.length === 0) {
                            results.push(currentPiece);
                            currentPiece = [];
                            i++;
                        } else {
                            currentPiece.push(items[i]);
                            i++;
                        }
                    }
                    if (sepItems.length > 0 || currentPiece.length > 0 || items.length === 0) {
                        results.push(currentPiece);
                    }
                } else {
                    let currentPiece = [];
                    for (let i = 0; i < items.length; i++) {
                        let match = false;
                        const a = items[i];
                        const b = sepVal;

                        // Handle primitive equality or ratmath types
                        if (typeof a === typeof b && a === b) match = true;
                        else if (a && b && a.constructor && b.constructor && a.constructor.name === b.constructor.name && ['Integer', 'Rational'].includes(a.constructor.name) && a.value === b.value && a.numerator === b.numerator) match = true;
                        else if (a && a.type === "string" && typeof b === "string" && a.value === b) match = true;
                        else if (a && b && a.type === "string" && b.type === "string" && a.value === b.value) match = true;
                        else if (a && b && a.constructor && b.constructor && a.constructor.name === "Integer" && b.constructor.name === "Integer" && a.value === b.value) match = true;

                        if (match) {
                            results.push(currentPiece);
                            currentPiece = [];
                        } else {
                            currentPiece.push(a);
                        }
                    }
                    results.push(currentPiece);
                }
            }

            if (isString) {
                return {
                    type: "sequence",
                    values: results.map(arr => {
                        const extracted = arr && Array.isArray(arr) ? arr.map(r => r && r.type === "string" ? r.value : r) : arr;
                        const s = typeof extracted === "string" ? extracted : extracted.map(r => r && r.type === 'string' ? r.value : r).join("");
                        return isStringObj ? { type: "string", value: s } : s;
                    })
                };
            } else {
                return {
                    type: "sequence",
                    values: results.map(arr => {
                        if (collection.type === "tuple") return { type: "tuple", values: arr };
                        return { type: collection.type || "sequence", values: arr };
                    })
                };
            }
        },
        doc: "Split a collection by a delimiter or predicate",
    },

    PCHUNK: {
        lazy: true,
        impl(args, context, evaluate) {
            const collection = evaluate(args[0]);
            const boundNode = args[1];

            if (collection === null || collection === undefined) {
                return null;
            }

            // Maps have no defined order and are not supported by chunk.
            if (collection.type === "map") {
                throw new Error("PCHUNK does not support maps — maps have no defined order");
            }

            const isStringObj = collection && collection.type === "string";
            const isString = typeof collection === "string" || isStringObj;
            let items = null;

            if (isString) {
                items = Array.from(isStringObj ? collection.value : collection).map(ch => isStringObj ? { type: "string", value: ch } : ch);
            } else if (collection && Array.isArray(collection.values)) {
                items = collection.values;
            } else {
                return null;
            }

            const boundVal = evaluate(boundNode);
            const results = [];

            const isFunc = (boundVal && (boundVal.type === "function" || boundVal.type === "lambda")) || typeof boundVal === "function";

            if (isFunc) {
                let currentChunk = [];
                // Predicate receives (val, locator, src) where locator is 1-based Integer position.
                for (let i = 0; i < items.length; i++) {
                    const loc = new Integer(BigInt(i + 1));
                    const isBound = isTruthy(invokeTraversalCallback(boundVal, [items[i], loc, collection], context, evaluate));

                    currentChunk.push(items[i]);
                    if (isBound) {
                        results.push(currentChunk);
                        currentChunk = [];
                    }
                }
                if (currentChunk.length > 0) {
                    results.push(currentChunk);
                }
            } else {
                // Integer n
                const nRaw = (boundVal && boundVal.constructor && boundVal.constructor.name === "Integer") ? Number(boundVal.value) : Number(boundVal);
                if (isNaN(nRaw) || nRaw <= 0) {
                    throw new Error("PCHUNK requires a positive integer size or a predicate function");
                }
                const n = Math.floor(nRaw);
                let currentChunk = [];
                for (let i = 0; i < items.length; i++) {
                    currentChunk.push(items[i]);
                    if (currentChunk.length === n) {
                        results.push(currentChunk);
                        currentChunk = [];
                    }
                }
                if (currentChunk.length > 0) {
                    results.push(currentChunk);
                }
            }

            if (isString) {
                return {
                    type: "sequence",
                    values: results.map(arr => {
                        const s = arr.map(x => typeof x === "string" ? x : (x && x.type === "string" ? x.value : x)).join("");
                        return isStringObj ? { type: "string", value: s } : s;
                    })
                };
            } else {
                return {
                    type: "sequence",
                    values: results.map(arr => {
                        if (collection.type === "tuple") return { type: "tuple", values: arr };
                        return { type: collection.type || "sequence", values: arr };
                    })
                };
            }
        },
        doc: "Chunk a collection into subarrays by size or boundary predicate",
    },

    PMAP: {
        lazy: true,
        impl(args, context, evaluate) {
            const collection = evaluate(args[0]);
            const funcNode = args[1];

            if (collection === null || collection === undefined) return null;

            const func = evaluate(funcNode);

            // Map support: transform values, preserve original keys.
            // Callback receives (val, key, src) where key is the canonical map key.
            if (collection.type === "map") {
                const entries = collection.entries;
                if (!(entries instanceof Map)) throw new Error("PMAP: invalid map");
                const newEntries = new Map();
                for (const [k, v] of entries) {
                    const loc = { type: "string", value: k };
                    const result = invokeTraversalCallback(func, [v, loc, collection], context, evaluate);
                    newEntries.set(k, result);
                }
                return { type: "map", entries: newEntries };
            }

            const isStringObj = (collection && collection.type === "string");
            const isString = typeof collection === "string" || isStringObj;
            let items = null;

            if (isString) {
                items = Array.from(isStringObj ? collection.value : collection).map(ch => isStringObj ? { type: "string", value: ch } : ch);
            } else if (collection && Array.isArray(collection.values)) {
                items = collection.values;
            } else {
                throw new Error("PMAP requires a collection");
            }

            // Callback receives (val, locator, src) where locator is 1-based Integer position.
            const results = items.map((item, i) => {
                const loc = new Integer(BigInt(i + 1));
                return invokeTraversalCallback(func, [item, loc, collection], context, evaluate);
            });

            if (isString) {
                let allSingleCharStr = true;
                for (let r of results) {
                    const rv = (r && r.type === "string") ? r.value : r;
                    if (rv === null) {
                        allSingleCharStr = false;
                        break;
                    }
                    if (typeof rv !== "string" || Array.from(rv).length !== 1) {
                        allSingleCharStr = false;
                        break;
                    }
                }
                if (allSingleCharStr) {
                    const strVal = results.map(r => (r && r.type === "string") ? r.value : r).join("");
                    return isStringObj ? { type: "string", value: strVal } : strVal;
                }
            }

            return { type: (collection.type && !isString) ? collection.type : "sequence", values: results };
        },
        doc: "Map a function over a collection — callback receives (val, locator, src)",
    },

    PFILTER: {
        lazy: true,
        impl(args, context, evaluate) {
            const collection = evaluate(args[0]);
            const funcNode = args[1];

            if (collection === null || collection === undefined) return null;

            const func = evaluate(funcNode);

            // Map support: keep entries whose predicate passes.
            // Callback receives (val, key, src).
            if (collection.type === "map") {
                const entries = collection.entries;
                if (!(entries instanceof Map)) throw new Error("PFILTER: invalid map");
                const newEntries = new Map();
                for (const [k, v] of entries) {
                    const loc = { type: "string", value: k };
                    if (isTruthy(invokeTraversalCallback(func, [v, loc, collection], context, evaluate))) {
                        newEntries.set(k, v);
                    }
                }
                return { type: "map", entries: newEntries };
            }

            const isStringObj = (collection && collection.type === "string");
            const isString = typeof collection === "string" || isStringObj;
            let items = null;

            if (isString) {
                items = Array.from(isStringObj ? collection.value : collection).map(ch => isStringObj ? { type: "string", value: ch } : ch);
            } else if (collection && Array.isArray(collection.values)) {
                items = collection.values;
            } else {
                throw new Error("PFILTER requires a collection");
            }

            // Callback receives (val, locator, src) where locator is 1-based Integer position.
            const results = items.filter((item, i) => {
                const loc = new Integer(BigInt(i + 1));
                return isTruthy(invokeTraversalCallback(func, [item, loc, collection], context, evaluate));
            });

            if (isString) {
                const filteredStr = results.map(r => r && r.type === "string" ? r.value : r).join("");
                return isStringObj ? { type: "string", value: filteredStr } : filteredStr;
            }

            return { type: collection.type || "sequence", values: results };
        },
        doc: "Filter a collection with a predicate — callback receives (val, locator, src)",
    },

    PREDUCE: {
        lazy: true,
        impl(args, context, evaluate) {
            const collection = evaluate(args[0]);
            const funcNode = args[1];
            const initProvided = args.length > 2;
            const explicitInit = initProvided ? evaluate(args[2]) : null;

            if (collection === null || collection === undefined) return null;

            const func = evaluate(funcNode);

            // Map support: reduce over map entries.
            // Callback receives (acc, val, key, src).
            // Implicit-init mode uses the first encountered value as accumulator.
            // Maps are unordered; no iteration-order guarantee is made to users.
            if (collection.type === "map") {
                const entries = collection.entries;
                if (!(entries instanceof Map)) throw new Error("PREDUCE: invalid map");
                const mapEntries = Array.from(entries.entries());
                let acc;
                let startIdx;
                if (!initProvided) {
                    if (mapEntries.length === 0) return null;
                    acc = mapEntries[0][1];
                    startIdx = 1;
                } else {
                    acc = explicitInit;
                    startIdx = 0;
                }
                for (let i = startIdx; i < mapEntries.length; i++) {
                    const [k, v] = mapEntries[i];
                    const loc = { type: "string", value: k };
                    acc = invokeTraversalCallback(func, [acc, v, loc, collection], context, evaluate);
                }
                return acc;
            }

            const isStringObj = (collection && collection.type === "string");
            const isString = typeof collection === "string" || isStringObj;
            let items = null;

            if (isString) {
                items = Array.from(isStringObj ? collection.value : collection).map(ch => isStringObj ? { type: "string", value: ch } : ch);
            } else if (collection && Array.isArray(collection.values)) {
                items = collection.values;
            } else {
                throw new Error("PREDUCE requires a collection");
            }

            // Callback receives (acc, val, locator, src) where locator is 1-based Integer position.
            let acc = initProvided ? explicitInit : items[0];
            const startIdx = initProvided ? 0 : 1;

            for (let i = startIdx; i < items.length; i++) {
                const loc = new Integer(BigInt(i + 1));
                acc = invokeTraversalCallback(func, [acc, items[i], loc, collection], context, evaluate);
            }

            return acc;
        },
        doc: "Reduce a collection with an accumulator function — callback receives (acc, val, locator, src)",
    },

    PREVERSE: {
        impl(args) {
            const collection = args[0];
            if (collection === null || collection === undefined) return null;

            const isStringObj = (collection && collection.type === "string");
            const isString = typeof collection === "string" || isStringObj;
            let items = null;

            if (isString) {
                items = Array.from(isStringObj ? collection.value : collection).map(ch => isStringObj ? { type: "string", value: ch } : ch);
                const reversed = items.reverse().map(r => r && r.type === "string" ? r.value : r).join("");
                return isStringObj ? { type: "string", value: reversed } : reversed;
            } else if (collection && Array.isArray(collection.values)) {
                return { type: collection.type || "sequence", values: [...collection.values].reverse() };
            } else {
                throw new Error("PREVERSE requires a collection");
            }
        },
        pure: true,
        doc: "Reverse a collection (returns new copy)",
    },

    PSORT: {
        lazy: true,
        impl(args, context, evaluate) {
            const collection = evaluate(args[0]);
            const funcNode = args[1];

            if (collection === null || collection === undefined) return null;

            // Maps have no defined order and are not supported by sort.
            if (collection.type === "map") {
                throw new Error("PSORT does not support maps — maps have no defined order");
            }

            const isStringObj = (collection && collection.type === "string");
            const isString = typeof collection === "string" || isStringObj;
            let items = null;

            if (isString) {
                items = Array.from(isStringObj ? collection.value : collection).map(ch => isStringObj ? { type: "string", value: ch } : ch);
            } else if (collection && Array.isArray(collection.values)) {
                items = collection.values;
            } else {
                throw new Error("PSORT requires a collection");
            }

            const func = evaluate(funcNode);
            const sorted = [...items].sort((a, b) => {
                if (func && func.type === "partial") {
                    const result = callWithConcreteArgs(func, [a, b], context, evaluate);
                    if (result && result.constructor && result.constructor.name === "Integer") return Number(result.value);
                    if (typeof result === "number") return result;
                    return 0;
                }
                if (func && func.type === "sysref") {
                    const result = evaluate({ fn: func.name, args: [a, b] });
                    if (result && result.constructor && result.constructor.name === "Integer") return Number(result.value);
                    if (typeof result === "number") return result;
                    return 0;
                }
                if (func && (func.type === "function" || func.type === "lambda")) {
                    const scope = new Map();
                    if (func.params?.positional?.length >= 2) {
                        scope.set(func.params.positional[0].name, a);
                        scope.set(func.params.positional[1].name, b);
                    }
                    context.push(scope);
                    try {
                        const result = evaluate(func.body);
                        if (result && result.constructor && result.constructor.name === "Integer") return Number(result.value);
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
                // Default string ordering for code points if no comparator and is string
                if (isString) {
                    const valA = a && a.type === "string" ? a.value : a;
                    const valB = b && b.type === "string" ? b.value : b;
                    if (valA < valB) return -1;
                    if (valA > valB) return 1;
                    return 0;
                }
                // Default: numeric sort
                const na = (a && a.constructor && a.constructor.name === "Integer") ? Number(a.value) : Number(a);
                const nb = (b && b.constructor && b.constructor.name === "Integer") ? Number(b.value) : Number(b);
                return na - nb;
            });

            if (isString) {
                const joined = sorted.map(r => r && r.type === "string" ? r.value : r).join("");
                return isStringObj ? { type: "string", value: joined } : joined;
            }

            return { type: collection.type || "sequence", values: sorted };
        },
        doc: "Sort a collection with comparator function (returns new copy)",
    },

    PALL: {
        lazy: true,
        impl(args, context, evaluate) {
            const collection = evaluate(args[0]);
            const funcNode = args[1];

            if (collection === null || collection === undefined) return null;

            const func = evaluate(funcNode);

            // Map support: test all entries with (val, key, src).
            // Returns last value if all pass; null on first failure or empty map.
            if (collection.type === "map") {
                const entries = collection.entries;
                if (!(entries instanceof Map)) throw new Error("PALL: invalid map");
                if (entries.size === 0) return null;
                let lastVal = null;
                for (const [k, v] of entries) {
                    const loc = { type: "string", value: k };
                    if (!isTruthy(invokeTraversalCallback(func, [v, loc, collection], context, evaluate))) {
                        return null;
                    }
                    lastVal = v;
                }
                return lastVal;
            }

            const isStringObj = (collection && collection.type === "string");
            const isString = typeof collection === "string" || isStringObj;
            let items = null;

            if (isString) {
                items = Array.from(isStringObj ? collection.value : collection).map(ch => isStringObj ? { type: "string", value: ch } : ch);
            } else if (collection && Array.isArray(collection.values)) {
                items = collection.values;
            } else {
                throw new Error("PALL requires a collection");
            }

            if (items.length === 0) {
                return null;
            }

            // Callback receives (val, locator, src) where locator is 1-based Integer position.
            let lastItem = null;
            for (let i = 0; i < items.length; i++) {
                const item = items[i];
                const loc = new Integer(BigInt(i + 1));
                if (!isTruthy(invokeTraversalCallback(func, [item, loc, collection], context, evaluate))) {
                    return null;
                }
                lastItem = item;
            }
            return lastItem;
        },
        doc: "Every: returns last element if predicate is truthy for ALL elements, null on first failure — callback receives (val, locator, src)",
    },

    PANY: {
        lazy: true,
        impl(args, context, evaluate) {
            const collection = evaluate(args[0]);
            const funcNode = args[1];

            if (collection === null || collection === undefined) return null;

            const func = evaluate(funcNode);

            // Map support: test entries with (val, key, src).
            // Returns first passing value; null if none pass or empty.
            if (collection.type === "map") {
                const entries = collection.entries;
                if (!(entries instanceof Map)) throw new Error("PANY: invalid map");
                for (const [k, v] of entries) {
                    const loc = { type: "string", value: k };
                    if (isTruthy(invokeTraversalCallback(func, [v, loc, collection], context, evaluate))) {
                        return v;
                    }
                }
                return null;
            }

            const isStringObj = (collection && collection.type === "string");
            const isString = typeof collection === "string" || isStringObj;
            let items = null;

            if (isString) {
                items = Array.from(isStringObj ? collection.value : collection).map(ch => isStringObj ? { type: "string", value: ch } : ch);
            } else if (collection && Array.isArray(collection.values)) {
                items = collection.values;
            } else {
                throw new Error("PANY requires a collection");
            }

            // Callback receives (val, locator, src) where locator is 1-based Integer position.
            for (let i = 0; i < items.length; i++) {
                const item = items[i];
                const loc = new Integer(BigInt(i + 1));
                if (isTruthy(invokeTraversalCallback(func, [item, loc, collection], context, evaluate))) {
                    return item;
                }
            }
            return null;
        },
        doc: "Any: returns first item that passed predicate, null if none pass — callback receives (val, locator, src)",
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
