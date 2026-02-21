/**
 * Control flow system functions: BLOCK, CASE, LOOP, TERNARY
 *
 * All are lazy — they receive raw IR nodes and use the evaluate
 * callback to selectively evaluate branches.
 */

import { Integer, Rational } from "@ratmath/core";

function isTruthy(val) {
    if (val === null || val === undefined) return false;
    if (val instanceof Integer) return val.value !== 0n;
    if (val instanceof Rational) return val.numerator !== 0n;
    if (typeof val === "number") return val !== 0;
    if (typeof val === "bigint") return val !== 0n;
    return Boolean(val);
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

export const controlFunctions = {
    BLOCK: {
        lazy: true,
        impl(args, context, evaluate) {
            let result = null;
            for (const stmt of args) {
                result = evaluate(stmt);
            }
            return result;
        },
        doc: "Sequential block execution, returns last value",
    },

    CASE: {
        lazy: true,
        impl(args, context, evaluate) {
            // CASE receives DEFER-wrapped elements from {? ... }
            // Each element is either:
            //   DEFER(CONDITION(test, action))  —  a condition ? action branch
            //   DEFER(expr)                      —  a default (fallback) branch
            for (let i = 0; i < args.length; i++) {
                const inner = unwrapDefer(args[i]);

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
            return null;
        },
        doc: "Conditional case expression: {? cond ? action; ... ; default }",
    },

    LOOP: {
        lazy: true,
        impl(args, context, evaluate) {
            // LOOP(init, condition, body, update)
            // All args are DEFER nodes
            const [initNode, condNode, bodyNode, updateNode] = args.map(unwrapDefer);

            // Init
            if (initNode) evaluate(initNode);

            let result = null;
            let iterations = 0;
            const maxIterations = 10000; // safety limit

            while (iterations < maxIterations) {
                // Check condition
                if (condNode) {
                    const condResult = evaluate(condNode);
                    if (!isTruthy(condResult)) break;
                }

                // Execute body
                if (bodyNode) {
                    result = evaluate(bodyNode);
                }

                // Update
                if (updateNode) {
                    evaluate(updateNode);
                }

                iterations++;
            }

            if (iterations >= maxIterations) {
                throw new Error("Loop exceeded maximum iterations (10000)");
            }

            return result;
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
};
