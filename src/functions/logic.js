/**
 * Logic system functions: AND, OR, NOT
 *
 * Truthiness: only null/undefined is falsy. Everything else (including 0) is truthy.
 * AND/OR return the deciding operand (JS-style short-circuit).
 * NOT returns Integer(1) for null, null for anything else.
 * Comparisons elsewhere return Integer(1) for true, null for false.
 */

import { Integer } from "@ratmath/core";

function isTruthy(val) {
    return val !== null && val !== undefined;
}

export const logicFunctions = {
    AND: {
        lazy: true,
        impl(args, ctx, evaluate) {
            let last = new Integer(1);
            for (const arg of args) {
                last = evaluate(arg);
                if (!isTruthy(last)) return last; // return the falsy value (null)
            }
            return last; // return last truthy value
        },
        pure: true,
        doc: "Logical AND (short-circuits on first falsy, returns deciding value)",
    },

    OR: {
        lazy: true,
        impl(args, ctx, evaluate) {
            let last = null;
            for (const arg of args) {
                last = evaluate(arg);
                if (isTruthy(last)) return last; // return first truthy value
            }
            return last; // return last falsy value (null)
        },
        pure: true,
        doc: "Logical OR (short-circuits on first truthy, returns deciding value)",
    },

    NOT: {
        impl(args) {
            return isTruthy(args[0]) ? null : new Integer(1);
        },
        pure: true,
        doc: "Logical NOT — returns Integer(1) for null input, null otherwise",
    },
};
