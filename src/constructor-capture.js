import { copyAllMeta, deepCopyValue, shallowCopyValue, transferMetaForUpdate } from "./cell.js";
import { runtimeDefaults } from "./runtime-config.js";

export const CONSTRUCTOR_CAPTURE_MODES = Object.freeze({
    alias: "alias",
    copy: "copy",
    refresh: "refresh",
    deepCopy: "deep_copy",
    deepRefresh: "deep_refresh",
});

export function captureModeFromOperator(operator) {
    switch (operator) {
        case "==":
        case "=":
            return CONSTRUCTOR_CAPTURE_MODES.alias;
        case ":=":
            return CONSTRUCTOR_CAPTURE_MODES.copy;
        case "~=":
            return CONSTRUCTOR_CAPTURE_MODES.refresh;
        case "::=":
            return CONSTRUCTOR_CAPTURE_MODES.deepCopy;
        case "~~=":
            return CONSTRUCTOR_CAPTURE_MODES.deepRefresh;
        default:
            return null;
    }
}

export function constructorDefaultCaptureMode(context) {
    return (
        context?.getEnv?.("defaultConstructorCaptureMode") ||
        runtimeDefaults.defaultConstructorCaptureMode
    );
}

export function captureResolvedValue(value, mode) {
    if (mode === CONSTRUCTOR_CAPTURE_MODES.alias) {
        return value;
    }

    if (mode === CONSTRUCTOR_CAPTURE_MODES.copy) {
        const next = shallowCopyValue(value);
        copyAllMeta(value, next, "shallow");
        return next;
    }

    if (mode === CONSTRUCTOR_CAPTURE_MODES.deepCopy) {
        const next = deepCopyValue(value);
        copyAllMeta(value, next, "deep");
        return next;
    }

    if (mode === CONSTRUCTOR_CAPTURE_MODES.refresh) {
        const next = shallowCopyValue(value);
        transferMetaForUpdate(null, next, value, "shallow");
        return next;
    }

    if (mode === CONSTRUCTOR_CAPTURE_MODES.deepRefresh) {
        const next = deepCopyValue(value);
        transferMetaForUpdate(null, next, value, "deep");
        return next;
    }

    return captureResolvedValue(value, runtimeDefaults.defaultConstructorCaptureMode);
}

export function captureIrValue(irNode, mode, context, evaluate) {
    if (mode === CONSTRUCTOR_CAPTURE_MODES.alias && irNode?.fn === "RETRIEVE") {
        const cell = context.getCell(irNode.args[0]);
        if (cell) return cell.value;
    }
    if (mode === CONSTRUCTOR_CAPTURE_MODES.alias && irNode?.fn === "OUTER_RETRIEVE") {
        const cell = context.getOuterCell(irNode.args[0]);
        if (cell) return cell.value;
    }

    const value = evaluate(irNode);
    return captureResolvedValue(value, mode);
}
