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
            if (fn?.type === "method_builtin") {
                return fn.impl([target, ...callArgs], context, evaluate, callWithConcreteArgs);
            }
            return callWithConcreteArgs(fn, [target, ...callArgs], context, evaluate);
        },
        doc: "Resolve and invoke a receiver-first method call",
    },
};
