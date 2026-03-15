/**
 * RiX Evaluator
 *
 * Walks an IR tree and dispatches to system functions via the registry.
 * IR nodes have the form: { fn: "NAME", args: [...] }
 *
 * The evaluate function is the core recursive interpreter.
 */

import fs from "node:fs";
import path from "node:path";
import { Registry } from "./registry.js";
import { SystemContext } from "./system-context.js";
import { Context } from "./context.js";
import { Cell, copyAllMeta, deepCopyValue, shallowCopyValue } from "./cell.js";
import { isHole } from "./hole.js";
import { runtimeDefaults } from "./runtime-config.js";
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
import { parse } from "../../parser/src/parser.js";
import { tokenize } from "../../parser/src/tokenizer.js";
import { lower } from "./lower.js";

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
const SCRIPT_RUNTIME_ENV_KEY = "__script_runtime__";

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

function getScriptRuntime(context, options = {}) {
    let runtime = context.getEnv(SCRIPT_RUNTIME_ENV_KEY);
    if (!runtime) {
        runtime = {
            systemLookup: options.systemLookup || defaultSystemLookup,
            preparedScripts: new Map(),
            activeImports: [],
            frameStack: [],
        };
        context.setEnv(SCRIPT_RUNTIME_ENV_KEY, runtime);
        return runtime;
    }

    if (!runtime.systemLookup) {
        runtime.systemLookup = options.systemLookup || defaultSystemLookup;
    }
    return runtime;
}

function getScriptCapabilityConfig(context) {
    const groupOverride = context.getEnv("capabilityGroups", null);
    const policyOverride = context.getEnv("defaultScriptCapabilityPolicy", null);
    const permissionOverride = context.getEnv("scriptPermissionNames", null);

    return {
        capabilityGroups: {
            ...runtimeDefaults.capabilityGroups,
            ...(groupOverride || {}),
        },
        defaultPolicy: {
            ...runtimeDefaults.defaultScriptCapabilityPolicy,
            ...(policyOverride || {}),
        },
        permissionNames: new Set(permissionOverride || runtimeDefaults.scriptPermissionNames),
    };
}

function getHostAvailablePermissions(context) {
    return new Set(getScriptCapabilityConfig(context).permissionNames);
}

function stripMeta(value) {
    if (value && typeof value === "object" && value._ext) {
        delete value._ext;
    }
    return value;
}

function cloneValueForBinding(value, mode) {
    if (mode === "copy") {
        return stripMeta(shallowCopyValue(value));
    }
    if (mode === "copy_meta") {
        const next = stripMeta(shallowCopyValue(value));
        copyAllMeta(value, next, "shallow");
        return next;
    }
    if (mode === "deep_copy") {
        return stripMeta(deepCopyValue(value));
    }
    if (mode === "deep_copy_meta") {
        const next = stripMeta(deepCopyValue(value));
        copyAllMeta(value, next, "deep");
        return next;
    }
    return value;
}

function buildBoundCell(sourceCell, mode) {
    if (mode === "alias") {
        return sourceCell;
    }
    return new Cell(cloneValueForBinding(sourceCell.value, mode));
}

function applyBindingToCurrentScope(context, target, sourceCell, mode) {
    if (mode === "alias") {
        context.setCell(target, sourceCell);
        return sourceCell.value;
    }
    const clonedCell = buildBoundCell(sourceCell, mode);
    context.setCell(target, clonedCell);
    return clonedCell.value;
}

function resolveCallerBindingCell(context, spec) {
    const sourceScope = spec.sourceScope || "current";
    const cell =
        sourceScope === "ancestor"
            ? context.getAncestorCell(spec.source)
            : context.getImmediateCell(spec.source);

    if (!cell) {
        const scopeLabel = sourceScope === "ancestor" ? "ancestor" : "current";
        throw new Error(`Undefined ${scopeLabel} variable for script binding: ${spec.source}`);
    }
    return cell;
}

function unwrapScriptBoundaryNode(node) {
    return node?.type === "Statement" ? node.expression : node;
}

function extractScriptInterface(ast, resolvedPath) {
    const meaningful = [];
    for (let i = 0; i < ast.length; i++) {
        const node = unwrapScriptBoundaryNode(ast[i]);
        if (!node || node.type === "Comment") continue;
        meaningful.push({ index: i, node });
    }

    let inputContract = null;
    let exportBindings = null;
    const removeIndices = new Set();

    if (meaningful.length > 0 && meaningful[0].node.type === "ScriptBindingsDeclaration") {
        inputContract = meaningful[0].node.bindings;
        removeIndices.add(meaningful[0].index);
    }

    if (
        meaningful.length > 0 &&
        meaningful[meaningful.length - 1].node.type === "ScriptBindingsDeclaration" &&
        meaningful[meaningful.length - 1].index !== meaningful[0]?.index
    ) {
        exportBindings = meaningful[meaningful.length - 1].node.bindings;
        removeIndices.add(meaningful[meaningful.length - 1].index);
    }

    const body = ast.filter((_, index) => !removeIndices.has(index));
    for (const stmt of body) {
        const node = unwrapScriptBoundaryNode(stmt);
        if (node?.type === "ScriptBindingsDeclaration") {
            throw new Error(`Script input/export declarations must appear only as the first or last statement (${resolvedPath})`);
        }
    }

    return { inputContract, exportBindings, body };
}

function prepareScript(resolvedPath, runtime) {
    const cached = runtime.preparedScripts.get(resolvedPath);
    if (cached) {
        return cached;
    }

    let source;
    try {
        source = fs.readFileSync(resolvedPath, "utf8");
    } catch (error) {
        throw new Error(`Unable to load script '${resolvedPath}': ${error.message}`);
    }

    const ast = parse(tokenize(source), runtime.systemLookup || defaultSystemLookup);
    const { inputContract, exportBindings, body } = extractScriptInterface(ast, resolvedPath);
    const prepared = {
        path: resolvedPath,
        dir: path.dirname(resolvedPath),
        inputContract,
        exportBindings,
        bodyIr: lower(body),
    };

    runtime.preparedScripts.set(resolvedPath, prepared);
    return prepared;
}

function restrictSystemContext(systemContext, allowedNames) {
    const child = new SystemContext(new Map(), false);
    for (const name of systemContext.getAllNames()) {
        if (allowedNames.has(name)) {
            child.register(name, systemContext.get(name));
        }
    }
    child.freeze();
    return child;
}

function expandCapabilityTarget(modifier, availableFunctions, availablePermissions, groups, permissionNames) {
    if (modifier.targetType === "all") {
        return {
            functions: new Set(availableFunctions),
            permissions: new Set(availablePermissions),
        };
    }

    if (modifier.targetType === "function") {
        return {
            functions: new Set([modifier.target]),
            permissions: new Set(),
        };
    }

    const groupEntries = groups[modifier.target];
    if (!Array.isArray(groupEntries)) {
        throw new Error(`Unknown capability group: ${modifier.target}`);
    }

    const functions = new Set();
    const permissions = new Set();
    for (const name of groupEntries) {
        if (permissionNames.has(name)) {
            permissions.add(name);
        } else {
            functions.add(name);
        }
    }
    return { functions, permissions };
}

function deriveScriptCapabilityFrame(systemContext, parentPermissions, modifiers, context) {
    const { capabilityGroups, defaultPolicy, permissionNames } = getScriptCapabilityConfig(context);
    const availableFunctions = new Set(systemContext.getAllNames());
    const availablePermissions = new Set(parentPermissions);

    const allowedFunctions = defaultPolicy.includeAllFunctions
        ? new Set(availableFunctions)
        : new Set((defaultPolicy.functions || []).filter((name) => availableFunctions.has(name)));
    const allowedPermissions = new Set(
        (defaultPolicy.permissions || []).filter((name) => availablePermissions.has(name)),
    );

    for (const modifier of modifiers || []) {
        const expanded = expandCapabilityTarget(
            modifier,
            availableFunctions,
            availablePermissions,
            capabilityGroups,
            permissionNames,
        );

        if (modifier.action === "add") {
            for (const name of expanded.functions) {
                if (availableFunctions.has(name)) {
                    allowedFunctions.add(name);
                }
            }
            for (const name of expanded.permissions) {
                if (availablePermissions.has(name)) {
                    allowedPermissions.add(name);
                }
            }
            continue;
        }

        for (const name of expanded.functions) {
            allowedFunctions.delete(name);
        }
        for (const name of expanded.permissions) {
            allowedPermissions.delete(name);
        }
    }

    return {
        systemContext: restrictSystemContext(systemContext, allowedFunctions),
        functionNames: allowedFunctions,
        permissions: allowedPermissions,
    };
}

function validateInputsAgainstContract(inputSpecs, inputContract) {
    if (!Array.isArray(inputContract) || inputContract.length === 0) {
        return;
    }

    const actualByTarget = new Map((inputSpecs || []).map((spec) => [spec.target, spec]));
    for (const contract of inputContract) {
        const actual = actualByTarget.get(contract.target);
        if (!actual) {
            throw new Error(`Missing required script input: ${contract.target}`);
        }

        if (contract.mode === "alias" && actual.mode !== "alias") {
            throw new Error(`Script input '${contract.target}' requires alias passing`);
        }
        if (contract.mode !== "alias" && actual.mode === "alias") {
            throw new Error(`Script input '${contract.target}' requires copy-style passing`);
        }
    }
}

function bindScriptInputs(scriptContext, parentContext, inputSpecs, inputContract) {
    validateInputsAgainstContract(inputSpecs, inputContract);

    for (const spec of inputSpecs || []) {
        const sourceCell = resolveCallerBindingCell(parentContext, spec);
        applyBindingToCurrentScope(scriptContext, spec.target, sourceCell, spec.mode);
    }
}

function buildExportBundle(scriptContext, exportBindings) {
    const entries = new Map();

    for (const spec of exportBindings || []) {
        const sourceCell = scriptContext.getCell(spec.source);
        if (!sourceCell) {
            throw new Error(`Cannot export undefined script binding: ${spec.source}`);
        }
        entries.set(spec.target, buildBoundCell(sourceCell, spec.mode));
    }

    return {
        type: "export_bundle",
        entries,
    };
}

function getExportBundleCell(bundle, name) {
    if (!bundle || bundle.type !== "export_bundle" || !(bundle.entries instanceof Map)) {
        return null;
    }
    return bundle.entries.get(name) ?? null;
}

function applyCallerOutputBindings(context, outputSpecs, bundle) {
    for (const spec of outputSpecs || []) {
        const sourceCell = getExportBundleCell(bundle, spec.source);
        if (!sourceCell) {
            throw new Error(`Unknown script export: ${spec.source}`);
        }
        applyBindingToCurrentScope(context, spec.target, sourceCell, spec.mode);
    }
}

function resolveScriptPath(requestedPath, runtime, context) {
    const currentFrame = runtime.frameStack[runtime.frameStack.length - 1];
    const baseDir = currentFrame?.dir || context.getEnv("scriptBaseDir", process.cwd());
    const relativePath = requestedPath.endsWith(".rix") ? requestedPath : `${requestedPath}.rix`;
    return path.resolve(baseDir, relativePath);
}

function evaluateScriptImport(spec, context, registry, systemContext) {
    const runtime = getScriptRuntime(context);
    const parentFrame = runtime.frameStack[runtime.frameStack.length - 1] || null;

    if (parentFrame && !parentFrame.permissions.has("IMPORTS")) {
        throw new Error("Script imports are not allowed in this script context");
    }

    const resolvedPath = resolveScriptPath(spec.path, runtime, context);
    if (runtime.activeImports.includes(resolvedPath)) {
        throw new Error(`Cyclic script import detected: ${[...runtime.activeImports, resolvedPath].join(" -> ")}`);
    }

    const prepared = prepareScript(resolvedPath, runtime);
    const parentPermissions = parentFrame
        ? new Set(parentFrame.permissions)
        : getHostAvailablePermissions(context);
    const capabilityFrame = deriveScriptCapabilityFrame(
        systemContext,
        parentPermissions,
        spec.capabilityModifiers || [],
        context,
    );

    const scriptContext = new Context();
    scriptContext.env = context.env;
    installSymbolicBindings(scriptContext);
    scriptContext.push(undefined, { isolated: true });

    runtime.activeImports.push(resolvedPath);
    runtime.frameStack.push({
        path: prepared.path,
        dir: prepared.dir,
        functionNames: capabilityFrame.functionNames,
        permissions: capabilityFrame.permissions,
    });

    try {
        bindScriptInputs(scriptContext, context, spec.inputs || [], prepared.inputContract);

        let finalResult = null;
        for (const node of prepared.bodyIr) {
            finalResult = evaluate(node, scriptContext, registry, capabilityFrame.systemContext);
        }

        if (!prepared.exportBindings || prepared.exportBindings.length === 0) {
            if (spec.outputs && spec.outputs.length > 0) {
                throw new Error("Caller-side script outputs require the imported script to declare exports");
            }
            return finalResult;
        }

        const bundle = buildExportBundle(scriptContext, prepared.exportBindings);
        applyCallerOutputBindings(context, spec.outputs || [], bundle);
        return bundle;
    } finally {
        runtime.frameStack.pop();
        runtime.activeImports.pop();
        scriptContext.pop();
    }
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

    if (fn === "SCRIPT_IMPORT") {
        return evaluateScriptImport(args[0] || {}, context, registry, systemContext);
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
    const evaluatedArgs = [];
    for (const arg of args) {
        if (arg === null || arg === undefined) {
            evaluatedArgs.push(arg);
        } else if (typeof arg !== "object" || Array.isArray(arg) || !arg.fn) {
            evaluatedArgs.push(arg);
        } else if (arg.fn === "SPREAD") {
            const spreadVal = evalFn(arg.args[0]);
            if (spreadVal && (spreadVal.type === "tuple" || spreadVal.type === "sequence" || spreadVal.type === "array" || spreadVal.type === "set")) {
                const items = spreadVal.values || spreadVal.elements || [];
                evaluatedArgs.push(...items);
            } else {
                throw new Error("Spread operator requires an iterable collection (array, tuple, sequence, set)");
            }
        } else {
            evaluatedArgs.push(evalFn(arg));
        }
    }

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
    const context = options.context || new Context();
    if (!options.context) {
        installSymbolicBindings(context);
    }
    const registry = options.registry || createDefaultRegistry();
    const systemContext = options.systemContext || createDefaultSystemContext();
    const systemLookup = options.systemLookup || defaultSystemLookup;
    getScriptRuntime(context, { systemLookup });

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
