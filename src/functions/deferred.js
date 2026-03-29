/**
 * Built-in methods for deferred (DEFER) values.
 *
 * Deferred values have the IR shape { fn: "DEFER", args: [<inner IR>] }.
 * These methods are attached via the PROTOS map in methods.js.
 *
 * - .Eval(bindings ?= _, mode ?= :inherit)  — evaluate the deferred block
 * - .Desugar(depth ?= -1)                   — pretty-print the raw IR tree
 * - .Inspect(bindings ?= {= }, depth ?= -1) — run in fresh scope with trace
 */

import { Integer } from "@ratmath/core";
import { isHole } from "../hole.js";
import { formatValue } from "../format.js";

// ---------------------------------------------------------------------------
// IR pretty-printer used by .Desugar
// ---------------------------------------------------------------------------

/**
 * Format a raw IR node into a human-readable string.
 *
 * maxDepth = -1 → unlimited
 * maxDepth = 0  → just the outermost function name with "(...)"; e.g. DEFER(...)
 *
 * BLOCK nodes and nodes whose arg text would be multi-line are rendered
 * with each arg on its own indented line so the output is easy to read.
 */
function desugarNode(node, maxDepth, currentDepth = 0) {
    if (node === null || node === undefined) return "_";
    if (isHole(node)) return "undefined";
    if (node instanceof Integer) return node.toString();
    if (typeof node === "string") return JSON.stringify(node);
    if (typeof node === "number" || typeof node === "bigint") return String(node);
    if (typeof node === "boolean") return String(node);
    if (typeof node !== "object") return String(node);

    // RiX string value
    if (node.type === "string") return JSON.stringify(node.value);

    // IR node: { fn, args }
    if (typeof node.fn === "string") {
        if (maxDepth >= 0 && currentDepth >= maxDepth) {
            return `${node.fn}(...)`;
        }
        if (!node.args || node.args.length === 0) {
            return node.fn;
        }

        const argStrs = node.args.map((a) => desugarNode(a, maxDepth, currentDepth + 1));

        // BLOCK nodes always go multiline; any node whose args produce multi-line
        // strings also goes multiline (preserves nested indentation).
        const isBlock = node.fn === "BLOCK";
        const hasMultilineArg = argStrs.some((s) => s.includes("\n"));

        if (isBlock || hasMultilineArg) {
            // Indent every line of every arg by two spaces
            const indented = argStrs.map((s) =>
                s.split("\n").map((line) => "  " + line).join("\n")
            );
            return `${node.fn}(\n${indented.join(",\n")}\n)`;
        }

        return `${node.fn}(${argStrs.join(", ")})`;
    }

    // Non-IR metadata object (e.g. loop config, break target)
    try {
        return JSON.stringify(node);
    } catch {
        return "[object]";
    }
}

// ---------------------------------------------------------------------------
// Helpers used by .Inspect
// ---------------------------------------------------------------------------

/**
 * A one-line label for an IR node used in trace output.
 * Literal string/number args are shown inline; nested IR nodes become "...".
 */
function nodeLabel(irNode) {
    if (!irNode || typeof irNode !== "object" || !irNode.fn) {
        return desugarNode(irNode, 0);
    }
    if (!irNode.args || irNode.args.length === 0) return irNode.fn;

    const argLabels = irNode.args.map((a) => {
        if (typeof a === "string") return JSON.stringify(a);
        if (a instanceof Integer) return a.toString();
        if (typeof a === "number" || typeof a === "bigint") return String(a);
        if (a && typeof a === "object" && a.fn) return "...";
        try { return JSON.stringify(a); } catch { return "[...]"; }
    });
    return `${irNode.fn}(${argLabels.join(", ")})`;
}

/**
 * Recursively walk an IR tree, evaluating each node and recording a trace.
 *
 * For BLOCK nodes the statements are evaluated in order (single evaluation
 * each — no double-eval risk).  For other nodes the full node is evaluated
 * once; if tracing deeper we also individually evaluate each IR-node arg
 * (an additional evaluation of pure sub-expressions; safe for arithmetic and
 * variable reads, but side-effectful expressions appear twice in the trace).
 *
 * @param {object}   irNode       IR node to trace
 * @param {Function} evaluate     evaluator from the calling context
 * @param {number}   maxDepth     max trace depth (-1 = unlimited)
 * @param {number}   currentDepth current recursion depth
 * @param {string[]} lines        accumulator for output lines
 * @param {string}   indent       current indentation string
 * @returns {*} evaluated result
 */
function traceNode(irNode, evaluate, maxDepth, currentDepth, lines, indent) {
    // Non-IR values (literals, primitives) — just evaluate silently
    if (!irNode || typeof irNode !== "object" || !irNode.fn) {
        return evaluate(irNode);
    }

    // Beyond depth limit — evaluate silently
    if (maxDepth >= 0 && currentDepth > maxDepth) {
        return evaluate(irNode);
    }

    const fn = irNode.fn;

    // DEFER inside a trace: show without entering the deferred body
    if (fn === "DEFER") {
        const result = evaluate(irNode);
        lines.push(`${indent}DEFER → ${formatValue(result)}`);
        return result;
    }

    // BLOCK: trace each statement in sequence — each is evaluated exactly once
    if (fn === "BLOCK") {
        let result = null;
        for (const stmt of irNode.args) {
            result = traceNode(stmt, evaluate, maxDepth, currentDepth, lines, indent);
        }
        return result;
    }

    // General case: evaluate the node once
    let result;
    try {
        result = evaluate(irNode);
    } catch (e) {
        lines.push(`${indent}${nodeLabel(irNode)} → ERROR: ${e.message}`);
        throw e;
    }

    lines.push(`${indent}${nodeLabel(irNode)} → ${formatValue(result)}`);

    // Recurse into IR-node args if within depth
    if (maxDepth < 0 || currentDepth < maxDepth) {
        if (Array.isArray(irNode.args)) {
            const childIndent = indent + "  ";
            for (const arg of irNode.args) {
                if (arg && typeof arg === "object" && arg.fn) {
                    traceNode(arg, evaluate, maxDepth, currentDepth + 1, lines, childIndent);
                }
            }
        }
    }

    return result;
}

// ---------------------------------------------------------------------------
// Shared arg-resolution helpers
// ---------------------------------------------------------------------------

function resolveIntArg(val, name) {
    if (val === null || val === undefined || isHole(val)) return -1;
    if (val instanceof Integer) return Number(val.value);
    if (typeof val === "number") return Math.trunc(val);
    throw new Error(`${name} must be an integer, got ${formatValue(val)}`);
}

function resolveBindings(val, name) {
    if (val === null || val === undefined || isHole(val)) return null;
    if (val.type === "map") return val;
    throw new Error(`${name} must be a map or null, got ${formatValue(val)}`);
}

// ---------------------------------------------------------------------------
// Method implementations
// ---------------------------------------------------------------------------

/**
 * .Eval(bindings ?= _, mode ?= :inherit)
 *
 * Evaluate this deferred block, optionally with injected bindings and/or
 * in a fresh (isolated) scope.  Behaviour is identical to .Eval(this, ...).
 */
const Eval = {
    type: "method_builtin",
    name: "Eval",
    impl([target, bindings, mode], context, evaluate) {
        const evalNodes = [target.args[0]];

        bindings = resolveBindings(bindings, "Eval bindings");

        let modeStr = "inherit";
        if (mode !== null && mode !== undefined && !isHole(mode)) {
            if (mode.type === "string") {
                modeStr = mode.value;
            } else {
                throw new Error("Eval mode must be a string or colon-string like :fresh or :inherit");
            }
        }
        if (modeStr !== "inherit" && modeStr !== "fresh") {
            throw new Error(`Eval mode must be 'inherit' or 'fresh', got '${modeStr}'`);
        }

        // Fast path: inherit mode, no bindings — run directly in caller's scope
        if (modeStr === "inherit" && (!bindings || bindings.entries.size === 0)) {
            let res = null;
            const runBody = () => {
                for (const irNode of evalNodes) res = evaluate(irNode);
                return res;
            };
            return context.withSharedBody(evalNodes[0], runBody);
        }

        context.push(undefined, { isolated: modeStr === "fresh" });
        try {
            if (bindings && bindings.entries) {
                for (const [k, v] of bindings.entries) {
                    if (typeof k !== "string") {
                        throw new Error(`Eval binding key must be a string, got ${String(k)}`);
                    }
                    context.setFresh(k, v);
                }
            }
            let res = null;
            const runBody = () => {
                for (const irNode of evalNodes) res = evaluate(irNode);
                return res;
            };
            if (evalNodes.length === 1) {
                return context.withSharedBody(evalNodes[0], runBody);
            }
            return runBody();
        } finally {
            context.pop();
        }
    },
};

/**
 * .Desugar(depth ?= -1)
 *
 * Return a string showing the raw IR structure of this deferred block.
 * depth = -1 means unlimited; depth = 0 shows only the top-level node.
 * BLOCK nodes and nodes with complex children are rendered with each argument
 * on its own indented line.  Nodes beyond the depth limit render as FN(...).
 */
const Desugar = {
    type: "method_builtin",
    name: "Desugar",
    impl([target, depth]) {
        const maxDepth = resolveIntArg(depth, "Desugar depth");
        const result = desugarNode(target, maxDepth, 0);
        return { type: "string", value: result };
    },
};

/**
 * .Inspect(bindings ?= {= }, depth ?= -1)
 *
 * Run the deferred block in a fresh isolated scope (injecting the optional
 * bindings map), and return a human-readable string that shows:
 *  - Inputs: each binding and its value
 *  - Trace: a depth-limited call trace showing what went into each function
 *           and what came out (depth = -1 is unlimited; depth = 0 disables
 *           the trace and shows only the final output)
 *  - Output: the final result value
 *
 * Note: tracing sub-expressions of non-BLOCK nodes involves re-evaluation.
 * This is safe for pure arithmetic and variable reads but may produce
 * duplicate trace entries for side-effectful operations (mutations, etc.).
 */
const Inspect = {
    type: "method_builtin",
    name: "Inspect",
    impl([target, bindings, depth], context, evaluate) {
        bindings = resolveBindings(bindings, "Inspect bindings");
        const maxDepth = resolveIntArg(depth, "Inspect depth");

        context.push(undefined, { isolated: true });
        let result = null;
        let errorMsg = null;
        const traceLines = [];

        try {
            if (bindings && bindings.entries) {
                for (const [k, v] of bindings.entries) {
                    context.setFresh(k, v);
                }
            }
            const evalNode = target.args[0];

            if (maxDepth === 0) {
                // No trace — just evaluate
                result = context.withSharedBody(evalNode, () => evaluate(evalNode));
            } else {
                // Trace — walk the inner IR
                result = context.withSharedBody(evalNode, () =>
                    traceNode(evalNode, evaluate, maxDepth, 0, traceLines, "  ")
                );
            }
        } catch (e) {
            errorMsg = e.message ?? String(e);
        } finally {
            context.pop();
        }

        const lines = ["--- Deferred Inspection ---", "Inputs:"];
        if (bindings && bindings.entries && bindings.entries.size > 0) {
            for (const [k, v] of bindings.entries) {
                lines.push(`  ${k} = ${formatValue(v)}`);
            }
        } else {
            lines.push("  (none)");
        }

        if (traceLines.length > 0) {
            lines.push("Trace:");
            lines.push(...traceLines);
        }

        if (errorMsg !== null) {
            lines.push(`Error: ${errorMsg}`);
        } else {
            lines.push(`Output: ${formatValue(result)}`);
        }

        return { type: "string", value: lines.join("\n") };
    },
};

export const deferredMethods = { EVAL: Eval, DESUGAR: Desugar, INSPECT: Inspect };
