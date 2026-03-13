/**
 * Control flow system functions: BLOCK, CASE, LOOP, BREAK, TERNARY
 *
 * All are lazy — they receive raw IR nodes and use the evaluate
 * callback to selectively evaluate branches.
 *
 * Truthiness: only null/undefined is falsy. Everything else is truthy.
 */

import { runtimeDefaults } from "../runtime-config.js";

function isTruthy(val) {
    return val !== null && val !== undefined;
}

/**
 * Unwrap a DEFER node: if the node is { fn: "DEFER", args: [body] },
 * return the body; otherwise return the node itself.
 */
function unwrapDefer(node) {
    if (node && node.fn === "DEFER" && node.args && node.args.length > 0) {
        return node.args[0];
    }
    return node;
}

function splitScopedBlockArgs(args) {
    const first = args[0];
    if (
        first &&
        !first.fn &&
        (
            Array.isArray(first.imports) ||
            first.name !== undefined ||
            first.maxIterations !== undefined ||
            first.unlimited === true
        )
    ) {
        return {
            imports: first.imports ?? [],
            containerName: first.name ?? null,
            maxIterations: first.maxIterations,
            unlimited: first.unlimited === true,
            bodyArgs: args.slice(1),
        };
    }
    return {
        imports: [],
        containerName: null,
        maxIterations: undefined,
        unlimited: false,
        bodyArgs: args,
    };
}

class BreakSignal extends Error {
    constructor(targetType, targetName, value) {
        const targetParts = [];
        if (targetType) targetParts.push(targetType);
        if (targetName) targetParts.push(`'${targetName}'`);
        const targetLabel = targetParts.length > 0 ? targetParts.join(" ") : "breakable construct";
        super(`No matching break target found for ${targetLabel}`);
        this.name = "BreakSignal";
        this.kind = "break";
        this.targetType = targetType ?? null;
        this.targetName = targetName ?? null;
        this.value = value;
    }
}

function isBreakSignal(error) {
    return Boolean(error) && error.kind === "break";
}

function matchesBreakTarget(signal, targetType, targetName) {
    if (!isBreakSignal(signal)) return false;
    if (signal.targetType !== null && signal.targetType !== targetType) {
        return false;
    }
    if (signal.targetName !== null && signal.targetName !== targetName) {
        return false;
    }
    return true;
}

function evaluateBreakValue(valueNode, context, evaluate) {
    context.push(undefined, { isolated: true, readThrough: true });
    try {
        return evaluate(valueNode);
    } finally {
        context.pop();
    }
}

function applyImports(imports, context) {
    for (const spec of imports) {
        if (spec.mode === "alias") {
            context.importAlias(spec.local, spec.source);
        } else {
            context.importCopy(spec.local, spec.source);
        }
    }
}

export const controlFunctions = {
    BLOCK: {
        lazy: true,
        impl(args, context, evaluate) {
            const { imports, containerName, bodyArgs } = splitScopedBlockArgs(args);
            const shareCurrentScope = context.consumeSharedBody("BLOCK");
            if (!shareCurrentScope) context.push(undefined, { isolated: true });
            try {
                applyImports(imports, context);
                let result = null;
                try {
                    for (const stmt of bodyArgs) {
                        result = evaluate(stmt);
                    }
                } catch (error) {
                    if (matchesBreakTarget(error, "block", containerName)) {
                        return error.value;
                    }
                    throw error;
                }
                return result;
            } finally {
                if (!shareCurrentScope) context.pop();
            }
        },
        doc: "Sequential block execution, returns last value",
    },

    CASE: {
        lazy: true,
        impl(args, context, evaluate) {
            const { containerName, bodyArgs } = splitScopedBlockArgs(args);
            // CASE receives DEFER-wrapped elements from {? ... }
            // Each element is either:
            //   DEFER(CONDITION(test, action))  —  a condition ? action branch
            //   DEFER(expr)                      —  a default (fallback) branch
            try {
                for (let i = 0; i < bodyArgs.length; i++) {
                    const inner = unwrapDefer(bodyArgs[i]);

                    // Check if this is a CONDITION node (from `cond ? action`)
                    if (inner && inner.fn === "CONDITION") {
                        const condResult = evaluate(inner.args[0]);
                        if (isTruthy(condResult)) {
                            return evaluate(inner.args[1]);
                        }
                        // Not truthy — try next branch
                        continue;
                    }

                    // Not a CONDITION node — it's a default/fallback
                    return evaluate(inner);
                }
            } catch (error) {
                if (matchesBreakTarget(error, "case", containerName)) {
                    return error.value;
                }
                throw error;
            }
            return null;
        },
        doc: "Conditional case expression: {? cond ? action; ... ; default }",
    },

    LOOP: {
        lazy: true,
        impl(args, context, evaluate) {
            // LOOP(init, condition, body, update)
            // All args are DEFER nodes
            const { imports, containerName, maxIterations: configuredMax, unlimited, bodyArgs } = splitScopedBlockArgs(args);
            const [initNode, condNode, bodyNode, updateNode] = bodyArgs.map(unwrapDefer);

            const shareCurrentScope = context.consumeSharedBody("LOOP");
            if (!shareCurrentScope) context.push(undefined, { isolated: true });
            try {
                applyImports(imports, context);
                // Init
                try {
                    if (initNode) evaluate(initNode);

                    let result = null;
                    let iterations = 0;
                    const maxIterations = unlimited
                        ? null
                        : configuredMax ?? context.getEnv("defaultLoopMax", runtimeDefaults.defaultLoopMax);

                    while (true) {
                        if (condNode) {
                            const condResult = evaluate(condNode);
                            if (!isTruthy(condResult)) break;
                        }

                        // The max check happens after the condition passes and before the next body run.
                        if (maxIterations !== null && iterations >= maxIterations) {
                            throw new Error(`Loop exceeded max iteration count: ${maxIterations}`);
                        }

                        if (bodyNode) {
                            result = evaluate(bodyNode);
                        }

                        if (updateNode) {
                            evaluate(updateNode);
                        }

                        iterations++;
                    }
                    return result;
                } catch (error) {
                    if (matchesBreakTarget(error, "loop", containerName)) {
                        return error.value;
                    }
                    throw error;
                }
            } finally {
                if (!shareCurrentScope) context.pop();
            }
        },
        doc: "Loop construct with init, condition, body, update",
    },

    TERNARY: {
        lazy: true,
        impl(args, context, evaluate) {
            // args[0] = condition (evaluated)
            // args[1] = true branch (DEFER)
            // args[2] = false branch (DEFER)
            const condResult = evaluate(args[0]);
            if (isTruthy(condResult)) {
                return evaluate(unwrapDefer(args[1]));
            } else {
                return evaluate(unwrapDefer(args[2]));
            }
        },
        doc: "Ternary conditional: condition ?? trueExpr ?: falseExpr",
    },

    BREAK: {
        lazy: true,
        impl(args, context, evaluate) {
            const meta = args[0] && !args[0].fn ? args[0] : {};
            const valueNode = args[0] && !args[0].fn ? args[1] : args[0];
            const value = evaluateBreakValue(valueNode, context, evaluate);
            throw new BreakSignal(meta.targetType, meta.targetName, value);
        },
        doc: "Structured break block that exits the nearest matching breakable construct",
    },

    SYSTEM: {
        lazy: true,
        impl(args, context, evaluate) {
            const { imports, containerName, bodyArgs } = splitScopedBlockArgs(args);
            const shareCurrentScope = context.consumeSharedBody("SYSTEM");
            if (!shareCurrentScope) context.push(undefined, { isolated: true });
            try {
                applyImports(imports, context);
                let result = null;
                for (const stmt of bodyArgs) {
                    result = evaluate(stmt);
                }
                return result;
            } finally {
                if (!shareCurrentScope) context.pop();
            }
        },
        doc: "Mathematical system container, currently evaluates as a block",
    },
};
