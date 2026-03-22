import { shallowCopyValue } from "../cell.js";
import { ensureMutableReceiver, resolveMethod } from "../methods.js";
import { callWithConcreteArgs } from "./functions.js";

function evaluateArgs(argNodes, evaluate) {
    const evaluatedArgs = [];
    for (const arg of argNodes) {
        if (arg && arg.fn === "SPREAD") {
            const spreadVal = evaluate(arg.args[0]);
            if (spreadVal && (spreadVal.type === "tuple" || spreadVal.type === "sequence" || spreadVal.type === "array" || spreadVal.type === "set")) {
                const items = spreadVal.values || spreadVal.elements || [];
                evaluatedArgs.push(...items);
            } else {
                throw new Error("Spread operator requires an iterable collection (array, tuple, sequence, set)");
            }
        } else {
            evaluatedArgs.push(evaluate(arg));
        }
    }
    return evaluatedArgs;
}

export const methodFunctions = {
    CALL_METHOD: {
        lazy: true,
        impl(args, context, evaluate) {
            const target = evaluate(args[0]);
            const methodName = args[1];
            const callArgs = evaluateArgs(args.slice(2), evaluate);

            if (methodName.endsWith("!")) {
                ensureMutableReceiver(target);
            }

            const fn = resolveMethod(target, methodName);
            return callWithConcreteArgs(fn, [target, ...callArgs], context, evaluate);
        },
        doc: "Resolve and invoke a receiver-first method call",
    },

    PUSH: {
        impl(args) {
            const [target, ...values] = args;
            if (!target || target.type !== "sequence") {
                throw new Error("Push is only defined for sequences");
            }
            const copy = shallowCopyValue(target);
            copy.values.push(...values);
            return copy;
        },
        doc: "Non-mutating sequence append",
    },

    "PUSH!": {
        impl(args) {
            const [target, ...values] = args;
            if (!target || target.type !== "sequence") {
                throw new Error("Push! is only defined for sequences");
            }
            target.values.push(...values);
            return target;
        },
        doc: "Mutating sequence append",
    },
};
