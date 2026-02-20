/**
 * RiX Evaluator
 *
 * Walks an IR tree and dispatches to system functions via the registry.
 * IR nodes have the form: { fn: "NAME", args: [...] }
 *
 * The evaluate function is the core recursive interpreter.
 */

import { Registry } from "./registry.js";
import { Context } from "./context.js";
import { coreFunctions } from "./functions/core.js";
import { arithmeticFunctions } from "./functions/arithmetic.js";
import { comparisonFunctions } from "./functions/comparison.js";
import { logicFunctions } from "./functions/logic.js";
import { controlFunctions } from "./functions/control.js";
import { collectionFunctions } from "./functions/collections.js";
import { functionFunctions } from "./functions/functions.js";

/**
 * Create a default registry with all built-in system functions.
 */
export function createDefaultRegistry() {
    const registry = new Registry();
    registry.registerAll(coreFunctions);
    registry.registerAll(arithmeticFunctions);
    registry.registerAll(comparisonFunctions);
    registry.registerAll(logicFunctions);
    registry.registerAll(controlFunctions);
    registry.registerAll(collectionFunctions);
    registry.registerAll(functionFunctions);
    return registry;
}

/**
 * Evaluate an IR node tree.
 *
 * @param {Object} irNode - IR node { fn, args } or a literal value
 * @param {Context} context - Evaluation context
 * @param {Registry} registry - System function registry
 * @returns {*} The evaluated result
 */
export function evaluate(irNode, context, registry) {
    // Null / undefined pass through
    if (irNode === null || irNode === undefined) {
        return null;
    }

    // Primitive values (strings used as names, numbers, etc.)
    if (typeof irNode !== "object") {
        return irNode;
    }

    // Arrays (e.g. param lists) — not IR nodes
    if (Array.isArray(irNode)) {
        return irNode;
    }

    // Not an IR node (no fn property) — pass through (e.g. param objects)
    if (!irNode.fn) {
        return irNode;
    }

    const { fn, args } = irNode;

    // DEFER: return the node itself without evaluating
    if (fn === "DEFER") {
        return irNode;
    }

    // Look up the function in the registry
    const funcDef = registry.get(fn);

    if (!funcDef) {
        throw new Error(`Unknown system function: ${fn}`);
    }

    // If the function is lazy, pass raw args (IR nodes)
    if (funcDef.lazy) {
        return funcDef.impl(args, context, (node) =>
            evaluate(node, context, registry),
        );
    }

    // Otherwise, evaluate all args first
    const evaluatedArgs = args.map((arg) => {
        if (arg === null || arg === undefined) return arg;
        if (typeof arg !== "object") return arg;
        if (Array.isArray(arg)) return arg;
        if (!arg.fn) return arg; // not an IR node
        return evaluate(arg, context, registry);
    });

    return funcDef.impl(evaluatedArgs, context, (node) =>
        evaluate(node, context, registry),
    );
}

/**
 * Convenience: parse RiX source code, lower to IR, and evaluate.
 *
 * @param {string} code - RiX source code
 * @param {Object} [options]
 * @param {Context} [options.context] - Evaluation context (creates new if not provided)
 * @param {Registry} [options.registry] - Function registry (creates default if not provided)
 * @param {Function} [options.systemLookup] - System symbol lookup for parser
 * @returns {*} The result of the last expression
 */
export function parseAndEvaluate(code, options = {}) {
    // Dynamic imports to avoid circular deps at module level
    const { tokenize } = require("../../parser/src/tokenizer.js");
    const { parse } = require("../../parser/src/parser.js");
    const { lower } = require("./lower.js");

    const context = options.context || new Context();
    const registry = options.registry || createDefaultRegistry();
    const systemLookup = options.systemLookup || defaultSystemLookup;

    const tokens = tokenize(code);
    const ast = parse(tokens, systemLookup);
    const irNodes = lower(ast);

    let result = null;
    for (const irNode of irNodes) {
        result = evaluate(irNode, context, registry);
    }
    return result;
}

/**
 * Default system lookup for the parser.
 * Recognizes common system identifiers.
 */
function defaultSystemLookup(name) {
    const builtins = {
        SIN: { type: "function", arity: 1 },
        COS: { type: "function", arity: 1 },
        TAN: { type: "function", arity: 1 },
        LOG: { type: "function", arity: 1 },
        EXP: { type: "function", arity: 1 },
        SQRT: { type: "function", arity: 1 },
        ABS: { type: "function", arity: 1 },
        MAX: { type: "function", arity: -1 },
        MIN: { type: "function", arity: -1 },
        PI: { type: "constant" },
        E: { type: "constant" },
        AND: {
            type: "operator",
            precedence: 40,
            associativity: "left",
            operatorType: "infix",
        },
        OR: {
            type: "operator",
            precedence: 30,
            associativity: "left",
            operatorType: "infix",
        },
        NOT: { type: "operator", precedence: 110, operatorType: "prefix" },
        IF: { type: "identifier" },
        HELP: { type: "identifier" },
        LOAD: { type: "identifier" },
        UNLOAD: { type: "identifier" },
    };
    return builtins[name] || { type: "identifier" };
}
