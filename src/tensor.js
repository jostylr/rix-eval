import { Integer, Rational, RationalInterval } from "@ratmath/core";
import { HOLE, isHole } from "./hole.js";

function exactInteger(value, label = "Index") {
    if (value instanceof Integer) {
        return Number(value.value);
    }
    if (value instanceof Rational) {
        if (value.denominator !== 1n) {
            throw new Error(`${label} must be an integer`);
        }
        return Number(value.numerator);
    }
    if (typeof value === "bigint") {
        return Number(value);
    }
    if (typeof value === "number") {
        if (!Number.isInteger(value)) {
            throw new Error(`${label} must be an integer`);
        }
        return value;
    }
    throw new Error(`${label} must be an integer`);
}

function normalizeIndex(rawIndex, dimLength, axis) {
    const index = exactInteger(rawIndex, `Index for axis ${axis + 1}`);
    if (index === 0) {
        throw new Error(`Tensor index 0 is invalid on axis ${axis + 1}`);
    }
    const normalized = index < 0 ? dimLength + 1 + index : index;
    if (normalized < 1 || normalized > dimLength) {
        throw new Error(
            `Tensor index ${index} is out of range for axis ${axis + 1} with length ${dimLength}`,
        );
    }
    return normalized;
}

function intervalEndpoints(value) {
    if (value instanceof RationalInterval) {
        return [value.start, value.end];
    }
    if (value && value.type === "interval") {
        return [value.lo, value.hi];
    }
    return null;
}

function valueToSelectorSpec(value) {
    const endpoints = intervalEndpoints(value);
    if (endpoints) {
        return {
            kind: "slice",
            start: endpoints[0],
            end: endpoints[1],
        };
    }
    return {
        kind: "index",
        value,
    };
}

export function isTensor(value) {
    return !!value &&
        value.type === "tensor" &&
        Array.isArray(value.data) &&
        Array.isArray(value.shape) &&
        Array.isArray(value.strides);
}

export function tensorRank(tensor) {
    return tensor.shape.length;
}

export function tensorShape(tensor) {
    return [...tensor.shape];
}

export function tensorSize(tensor) {
    return tensor.shape.reduce((product, dim) => product * dim, 1);
}

export function computeDefaultStrides(shape) {
    const strides = new Array(shape.length);
    let stride = 1;
    for (let i = shape.length - 1; i >= 0; i--) {
        strides[i] = stride;
        stride *= shape[i];
    }
    return strides;
}

export function createTensor(shape, data = null, options = {}) {
    if (!Array.isArray(shape)) {
        throw new Error("Tensor shape must be an array");
    }

    const normalizedShape = shape.map((dim, axis) => {
        const n = exactInteger(dim, `Tensor shape axis ${axis + 1}`);
        if (n < 0) {
            throw new Error(`Tensor shape axis ${axis + 1} must be nonnegative`);
        }
        return n;
    });

    const size = normalizedShape.reduce((product, dim) => product * dim, 1);
    const actualData = data ? [...data] : new Array(size).fill(HOLE);
    if (actualData.length !== size) {
        throw new Error(
            `Tensor literal element count mismatch (expected ${size}, got ${actualData.length})`,
        );
    }

    return {
        type: "tensor",
        data: actualData,
        shape: normalizedShape,
        strides: options.strides ? [...options.strides] : computeDefaultStrides(normalizedShape),
        offset: options.offset ?? 0,
        _ext: options.ext ?? new Map([["mutable", new Integer(1n)]]),
    };
}

export function createTensorView(tensor, view) {
    if (!isTensor(tensor)) {
        throw new Error("Cannot create a tensor view from a non-tensor value");
    }
    return {
        type: "tensor",
        data: tensor.data,
        shape: [...view.shape],
        strides: [...view.strides],
        offset: view.offset,
        _ext: tensor._ext,
    };
}

export function tensorIndexTuple(indices) {
    return {
        type: "tuple",
        values: indices.map((index) => new Integer(BigInt(index))),
    };
}

export function linearIndexToTuple(linearIndex, shape) {
    if (shape.length === 0) {
        return [];
    }

    const defaultStrides = computeDefaultStrides(shape);
    const tuple = new Array(shape.length);
    let remaining = linearIndex;

    for (let axis = 0; axis < shape.length; axis++) {
        const stride = defaultStrides[axis];
        const dim = shape[axis];
        if (dim === 0) {
            return [];
        }
        tuple[axis] = Math.floor(remaining / stride) + 1;
        remaining %= stride;
    }

    return tuple;
}

export function tensorOffsetForTuple(tensor, tuple) {
    let offset = tensor.offset;
    for (let axis = 0; axis < tensor.shape.length; axis++) {
        offset += (tuple[axis] - 1) * tensor.strides[axis];
    }
    return offset;
}

export function forEachTensorCell(tensor, callback) {
    const size = tensorSize(tensor);
    if (tensor.shape.length === 0) {
        callback(tensor.data[tensor.offset], [], tensor.offset);
        return;
    }

    for (let linear = 0; linear < size; linear++) {
        const tuple = linearIndexToTuple(linear, tensor.shape);
        const offset = tensorOffsetForTuple(tensor, tuple);
        callback(tensor.data[offset], tuple, offset);
    }
}

export function normalizeTensorSelectors(tensor, selectorSpecs) {
    let specs = selectorSpecs;

    if (
        specs.length === 1 &&
        specs[0]?.kind === "index" &&
        specs[0].value &&
        specs[0].value.type === "tuple"
    ) {
        specs = specs[0].value.values.map((value) => valueToSelectorSpec(value));
    }

    if (specs.length !== tensor.shape.length) {
        throw new Error(
            `Tensor rank mismatch: expected ${tensor.shape.length} indices, got ${specs.length}`,
        );
    }

    return specs.map((spec, axis) => {
        if (spec.kind === "index") {
            const normalizedSpec = valueToSelectorSpec(spec.value);
            if (normalizedSpec.kind === "slice") {
                spec = normalizedSpec;
            }
        }

        if (spec.kind === "full") {
            const start = normalizeIndex(1, tensor.shape[axis], axis);
            const end = normalizeIndex(-1, tensor.shape[axis], axis);
            const direction = start <= end ? 1 : -1;
            return {
                kind: "slice",
                start,
                end,
                direction,
                length: Math.abs(end - start) + 1,
            };
        }

        if (spec.kind === "slice") {
            const start = normalizeIndex(spec.start, tensor.shape[axis], axis);
            const end = normalizeIndex(spec.end, tensor.shape[axis], axis);
            const direction = start <= end ? 1 : -1;
            return {
                kind: "slice",
                start,
                end,
                direction,
                length: Math.abs(end - start) + 1,
            };
        }

        return {
            kind: "index",
            index: normalizeIndex(spec.value, tensor.shape[axis], axis),
        };
    });
}

export function tensorGetBySelectors(tensor, selectorSpecs) {
    const selectors = normalizeTensorSelectors(tensor, selectorSpecs);
    let offset = tensor.offset;
    const shape = [];
    const strides = [];

    for (let axis = 0; axis < selectors.length; axis++) {
        const selector = selectors[axis];
        const stride = tensor.strides[axis];

        if (selector.kind === "index") {
            offset += (selector.index - 1) * stride;
            continue;
        }

        offset += (selector.start - 1) * stride;
        shape.push(selector.length);
        strides.push(stride * selector.direction);
    }

    if (shape.length === 0) {
        const value = tensor.data[offset];
        return isHole(value) ? null : value;
    }

    return createTensorView(tensor, { shape, strides, offset });
}

export function tensorAssignBySelectors(tensor, selectorSpecs, value) {
    const selectors = normalizeTensorSelectors(tensor, selectorSpecs);
    let offset = tensor.offset;
    const shape = [];
    const strides = [];

    for (let axis = 0; axis < selectors.length; axis++) {
        const selector = selectors[axis];
        const stride = tensor.strides[axis];

        if (selector.kind === "index") {
            offset += (selector.index - 1) * stride;
            continue;
        }

        offset += (selector.start - 1) * stride;
        shape.push(selector.length);
        strides.push(stride * selector.direction);
    }

    if (shape.length === 0) {
        tensor.data[offset] = value;
        return value;
    }

    const view = createTensorView(tensor, { shape, strides, offset });
    forEachTensorCell(view, (_cellValue, _tuple, cellOffset) => {
        tensor.data[cellOffset] = value;
    });
    return value;
}

export function coerceShapeValue(shapeValue) {
    if (isTensor(shapeValue)) {
        return tensorShape(shapeValue);
    }
    if (shapeValue && shapeValue.type === "tuple") {
        return shapeValue.values.map((value, axis) =>
            exactInteger(value, `Tensor shape axis ${axis + 1}`),
        );
    }
    throw new Error("TGEN expects a tensor or tuple shape");
}
