/**
 * RiX Evaluator
 *
 * Walks an IR tree and dispatches to system functions via the registry.
 * IR nodes have the form: { fn: "NAME", args: [...] }
 *
 * The evaluate function is the core recursive interpreter.
 */

import { Registry } from "./registry.js";
import { SystemContext } from "./system-context.js";
import { Context } from "./context.js";
import { isHole } from "./hole.js";
import { coreFunctions } from "./functions/core.js";
import { arithmeticFunctions } from "./functions/arithmetic.js";
import { comparisonFunctions } from "./functions/comparison.js";
import { logicFunctions } from "./functions/logic.js";
import { controlFunctions } from "./functions/control.js";
import { collectionFunctions } from "./functions/collections.js";
import { functionFunctions } from "./functions/functions.js";
import { propertyFunctions } from "./functions/properties.js";
import { advancedFunctions } from "./functions/advanced.js";
import { stdlibFunctions } from "./functions/stdlib.js";
import { installSymbolicBindings, symbolicFunctions } from "./functions/symbolic.js";

/**
 * Create the internal operator/language registry (no user-accessible stdlib).
 * Stdlib functions are now in SystemContext, accessible only via `.Name()`.
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
    registry.registerAll(propertyFunctions);
    registry.registerAll(advancedFunctions);
    registry.registerAll(symbolicFunctions);
    // Note: stdlibFunctions no longer registered here — use createDefaultSystemContext()
    return registry;
}

// Operator alias names exposed in the system context (accessible as .ADD, .SUB, @+, @*, etc.)
const OPERATOR_ALIAS_NAMES = ["ADD", "SUB", "MUL", "DIV", "INTDIV", "MOD", "POW",
    "EQ", "NEQ", "LT", "GT", "LTE", "GTE", "AND", "OR", "NOT"];

/**
 * Create a default SystemContext with all stdlib capabilities, frozen by default.
 * Operator implementations (ADD, SUB, etc.) are also exposed so @+ / .ADD work.
 * Pass { frozen: false } to get a mutable context for host-side customisation.
 *
 * @param {Object} [options]
 * @param {boolean} [options.frozen=true] - Start frozen (default) or mutable
 */
export function createDefaultSystemContext(options = {}) {
    const frozen = options.frozen !== false; // default true
    const ctx = new SystemContext(new Map(), false); // always build unfrozen
    ctx.registerAll(stdlibFunctions);
    // User-callable property functions (KEYOF, KEYS, VALUES)
    const userPropertyNames = ["KEYOF", "KEYS", "VALUES"];
    for (const name of userPropertyNames) {
        if (propertyFunctions[name]) ctx.register(name, propertyFunctions[name]);
    }
    // Expose operator implementations so @+ / .ADD work as first-class references
    const opSources = { ...arithmeticFunctions, ...comparisonFunctions, ...logicFunctions };
    for (const name of OPERATOR_ALIAS_NAMES) {
        if (opSources[name]) ctx.register(name, opSources[name]);
    }
    if (frozen) ctx.freeze();
    return ctx;
}

/**
 * Evaluate an IR node tree.
 *
 * @param {Object} irNode - IR node { fn, args } or a literal value
 * @param {Context} context - Evaluation context (variable scope)
 * @param {Registry} registry - Internal operator registry
 * @param {SystemContext} [systemContext] - User-accessible capability object (`.`)
 * @returns {*} The evaluated result
 */
export function evaluate(irNode, context, registry, systemContext) {
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

    // Bind the recursive evaluator for callbacks
    const evalFn = (node) => evaluate(node, context, registry, systemContext);

    // --- System context operations (. prefix syntax) ---

    // SYS_OBJ: bare `.` — returns a copy of the system context as a RiX value
    if (fn === "SYS_OBJ") {
        if (!systemContext) throw new Error("No system context available");
        return systemContext.copy().toRixValue();
    }

    // SYS_GET: .Name — get a capability reference or meta flag
    if (fn === "SYS_GET") {
        const name = args[0];
        if (!systemContext) throw new Error("No system context available");
        // Meta flags
        if (name === "FREEZE" || name === "freeze") {
            return systemContext.frozen ? 1 : 0;
        }
        // Capability reference — return as sysref for callWithConcreteArgs compatibility
        if (!systemContext.has(name)) {
            throw new Error(`Unknown system capability: ${name}`);
        }
        return { type: "sysref", name };
    }

    // SYS_CALL: .Name(args) — call a system capability
    // Handled lazily so placeholder detection works for partial application
    if (fn === "SYS_CALL") {
        const name = args[0];
        const callArgNodes = args.slice(1);
        if (!systemContext) throw new Error("No system context available");
        const cap = systemContext.get(name);
        if (!cap) {
            throw new Error(`Unknown system capability: ${name}. Use .${name}() only if the capability exists.`);
        }
        // Partial application: if any arg is a placeholder, build a partial
        const isPlaceholder = (n) => n && typeof n === "object" && n.fn === "PLACEHOLDER";
        if (callArgNodes.some(isPlaceholder)) {
            const template = callArgNodes.map((a) => evalFn(a));
            return { type: "partial", fn: { type: "sysref", name }, template };
        }
        if (cap.lazy) {
            return cap.impl(callArgNodes, context, evalFn);
        }
        const callArgs = callArgNodes.map((a) => {
            if (a === null || a === undefined) return a;
            if (typeof a !== "object") return a;
            if (Array.isArray(a)) return a;
            if (!a.fn) return a;
            return evalFn(a);
        });
        return cap.impl(callArgs, context, evalFn);
    }

    // SYS_SET: .Name = val — set a system context meta flag (only freeze/immutable)
    if (fn === "SYS_SET") {
        const name = args[0];
        const value = evalFn(args[1]);
        if (!systemContext) throw new Error("No system context available");
        const normalised = name.toUpperCase ? name.toUpperCase() : name;
        if (normalised === "FREEZE") {
            if (value) systemContext.freeze();
            return value;
        }
        throw new Error(`Cannot set system context property '${name}' via assignment. Use .Withhold() or .With() to create a modified copy.`);
    }

    // --- Internal registry dispatch ---

    const funcDef = registry.get(fn);

    if (!funcDef) {
        throw new Error(`Unknown system function: ${fn}`);
    }

    // If the function is lazy, pass raw args (IR nodes)
    if (funcDef.lazy) {
        return funcDef.impl(args, context, evalFn);
    }

    // Otherwise, evaluate all args first
    const evaluatedArgs = args.map((arg) => {
        if (arg === null || arg === undefined) return arg;
        if (typeof arg !== "object") return arg;
        if (Array.isArray(arg)) return arg;
        if (!arg.fn) return arg; // not an IR node
        return evalFn(arg);
    });

    // Hole check: standard (non-hole-aware) operations cannot consume holes
    if (!funcDef.holeAware) {
        for (const arg of evaluatedArgs) {
            if (isHole(arg)) {
                throw new Error(`Cannot use undefined/hole value in computation (in ${fn})`);
            }
        }
    }

    return funcDef.impl(evaluatedArgs, context, evalFn);
}

/**
 * Convenience: parse RiX source code, lower to IR, and evaluate.
 *
 * @param {string} code - RiX source code
 * @param {Object} [options]
 * @param {Context} [options.context] - Evaluation context (creates new if not provided)
 * @param {Registry} [options.registry] - Internal registry (creates default if not provided)
 * @param {SystemContext} [options.systemContext] - System capability object (creates default if not provided)
 * @param {Function} [options.systemLookup] - System symbol lookup for parser
 * @returns {*} The result of the last expression
 */
export function parseAndEvaluate(code, options = {}) {
    // Dynamic imports to avoid circular deps at module level
    const { tokenize } = require("../../parser/src/tokenizer.js");
    const { parse } = require("../../parser/src/parser.js");
    const { lower } = require("./lower.js");

    const context = options.context || new Context();
    if (!options.context) {
        installSymbolicBindings(context);
    }
    const registry = options.registry || createDefaultRegistry();
    const systemContext = options.systemContext || createDefaultSystemContext();
    const systemLookup = options.systemLookup || defaultSystemLookup;

    const tokens = tokenize(code);
    const ast = parse(tokens, systemLookup);
    const irNodes = lower(ast);

    let result = null;
    for (const irNode of irNodes) {
        result = evaluate(irNode, context, registry, systemContext);
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
        AND: { type: "function", lazy: true },
        OR: { type: "function", lazy: true },
        NOT: { type: "function" },
        IF: { type: "identifier" },
        HELP: { type: "identifier" },
        LOAD: { type: "identifier" },
        UNLOAD: { type: "identifier" },
    };
    return builtins[name] || { type: "identifier" };
}
