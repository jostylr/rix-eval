/**
 * Evaluation Context
 *
 * Manages the scope chain for variable storage during evaluation.
 * All bindings store Cell objects (mutable value boxes).
 *
 * Cell sharing enables true aliasing:
 *   b = a   → b and a share the SAME Cell; mutations via ~= are visible to both
 *   a = expr → a gets a NEW Cell; b still holds the old Cell
 *   a ~= v   → mutates Cell in-place; all names sharing that Cell see the change
 */

import { Cell } from "./cell.js";

export class Context {
    constructor() {
        // Global scope: Map<name, Cell>
        this.globalScope = new Map();
        // Stack of local scopes (innermost = last element).
        // Each entry is { bindings: Map<name, Cell>, isolated, readThrough }.
        this.localScopes = [];
        // User-defined functions: name → funcDef
        this.functions = new Map();
        // Environment config
        this.env = new Map();
        // Call stack for debugging
        this.callStack = [];
        this.currentCallables = [];
        // One-shot overrides for top-level function/lambda bodies that should
        // reuse the current local scope instead of creating a nested block scope.
        this.sharedBodyOverrides = [];
    }

    // --- Scope management ---

    /**
     * Push a new local scope.
     * @param {Map|Object} [initial] - Optional initial bindings (raw values, wrapped in Cells)
     * @returns {Map} The new bindings Map
     */
    push(initial, options = {}) {
        const rawMap =
            initial instanceof Map
                ? initial
                : new Map(initial ? Object.entries(initial) : []);
        const bindings = new Map();
        for (const [k, v] of rawMap) {
            // If already a Cell (e.g. passed from setCell context), share it;
            // otherwise wrap in a new Cell.
            bindings.set(k, v instanceof Cell ? v : new Cell(v));
        }
        const scope = {
            bindings,
            isolated: options.isolated === true,
            readThrough: options.readThrough === true,
        };
        this.localScopes.push(scope);
        return bindings;
    }

    /**
     * Pop the innermost local scope.
     */
    pop() {
        return this.localScopes.pop();
    }

    /**
     * Get a variable value, searching from innermost scope outward.
     */
    get(name) {
        const cell = this._findCell(name);
        return cell ? cell.value : undefined;
    }

    /**
     * Write a value to the current scope.
     * If a Cell already exists for name in the current scope, updates it in-place
     * (cell-preserving). Otherwise creates a new Cell in the current scope.
     * @param {string} name
     * @param {*} value
     */
    set(name, value) {
        if (this.localScopes.length > 0) {
            const scope = this.localScopes[this.localScopes.length - 1];
            const cell = scope.bindings.get(name);
            if (cell) {
                cell.value = value;
                return;
            }
            scope.bindings.set(name, new Cell(value));
        } else {
            const cell = this.globalScope.get(name);
            if (cell) {
                cell.value = value;
                return;
            }
            this.globalScope.set(name, new Cell(value));
        }
    }

    /**
     * Create a fresh Cell for name in the current scope, breaking any sharing.
     * Used by := and = with expression rhs.
     */
    setFresh(name, value) {
        const newCell = new Cell(value);
        if (this.localScopes.length > 0) {
            this.localScopes[this.localScopes.length - 1].bindings.set(name, newCell);
        } else {
            this.globalScope.set(name, newCell);
        }
    }

    /**
     * Store an existing Cell for name in the current scope.
     * Used by = with variable rhs to share a Cell between two names.
     */
    setCell(name, cell) {
        if (this.localScopes.length > 0) {
            this.localScopes[this.localScopes.length - 1].bindings.set(name, cell);
        } else {
            this.globalScope.set(name, cell);
        }
    }

    /**
     * Find the Cell for name, searching from innermost scope outward.
     * Returns null if not found.
     */
    getCell(name) {
        return this._findCell(name);
    }

    /**
     * Find the Cell for name in the immediate/current scope only.
     * If there is no local scope, this means the global scope.
     */
    getImmediateCell(name) {
        if (this.localScopes.length > 0) {
            return this.localScopes[this.localScopes.length - 1].bindings.get(name) ?? null;
        }
        return this.globalScope.get(name) ?? null;
    }

    /**
     * Find the Cell for name in outer scopes (skipping the innermost local scope).
     * Used by OUTER_UPDATE and importAlias.
     */
    getOuterCell(name) {
        return this._findCell(name, { skipInnermost: true, respectIsolation: false });
    }

    /**
     * Find the Cell for name in ancestor scopes only, excluding the current scope.
     * If there is no local scope, there is no ancestor scope.
     */
    getAncestorCell(name) {
        if (this.localScopes.length === 0) {
            return null;
        }
        return this._findCell(name, { skipInnermost: true, respectIsolation: false });
    }

    /**
     * Set a variable in the global scope regardless of local scopes.
     */
    setGlobal(name, value) {
        const cell = this.globalScope.get(name);
        if (cell) {
            cell.value = value;
        } else {
            this.globalScope.set(name, new Cell(value));
        }
    }

    /**
     * Get a variable value from the outer scopes (skipping the innermost local scope).
     */
    getOuter(name) {
        const cell = this._findCell(name, { skipInnermost: true, respectIsolation: false });
        return cell ? cell.value : undefined;
    }

    /**
     * Write a value to an existing outer scope variable (cell-preserving).
     * Throws if the variable doesn't exist in any outer scope.
     */
    setOuter(name, value) {
        const cell = this._findCell(name, { skipInnermost: true, respectIsolation: false });
        if (cell) {
            cell.value = value;
            return;
        }
        throw new Error(`Cannot assign to outer variable '@${name}' because it does not exist in any outer scope.`);
    }

    /**
     * Check if a variable exists in any scope.
     */
    has(name) {
        return Boolean(this._findCell(name));
    }

    getCallable(name) {
        const cell = this._findCell(name, { respectIsolation: false });
        if (cell) {
            return cell.value;
        }
        if (this.functions.has(name)) {
            return this.functions.get(name);
        }
        return undefined;
    }

    /**
     * Find the Cell for name by searching the scope chain.
     * @param {string} name
     * @param {object} [options]
     * @returns {Cell|null}
     */
    _findCell(name, options = {}) {
        const skipInnermost = options.skipInnermost === true;
        const respectIsolation = options.respectIsolation !== false;
        const startIndex = this.localScopes.length - 1 - (skipInnermost ? 1 : 0);

        for (let i = startIndex; i >= 0; i--) {
            const scope = this.localScopes[i];
            const cell = scope.bindings.get(name);
            if (cell) return cell;

            if (scope.readThrough) {
                const outerScope = this.localScopes[i - 1];
                if (outerScope) {
                    return outerScope.bindings.get(name) ?? null;
                }
                return this.globalScope.get(name) ?? null;
            }
            if (respectIsolation && scope.isolated) {
                return null;
            }
        }

        return this.globalScope.get(name) ?? null;
    }

    importCopy(localName, sourceName) {
        if (this.localScopes.length === 0) {
            throw new Error("Import headers require an active local scope");
        }
        const cell = this._findCell(sourceName, { skipInnermost: true, respectIsolation: false });
        if (!cell) {
            throw new Error(`Undefined outer variable for import: ${sourceName}`);
        }
        const scope = this.localScopes[this.localScopes.length - 1];
        scope.bindings.set(localName, new Cell(cell.value));
    }

    importAlias(localName, sourceName) {
        if (this.localScopes.length === 0) {
            throw new Error("Import headers require an active local scope");
        }
        const cell = this._findCell(sourceName, { skipInnermost: true, respectIsolation: false });
        if (!cell) {
            throw new Error(`Undefined outer variable for import alias: ${sourceName}`);
        }
        const scope = this.localScopes[this.localScopes.length - 1];
        // Share the same Cell — mutations via ~= will be visible in both scopes.
        scope.bindings.set(localName, cell);
    }

    /**
     * Define a user function.
     */
    defineFunction(name, funcDef) {
        this.set(name, funcDef);
        if (this.localScopes.length === 0) {
            this.functions.set(name, funcDef);
        }
    }

    /**
     * Get a user function definition.
     */
    getFunction(name) {
        return this.getCallable(name);
    }

    // --- Call stack ---

    pushCall(name) {
        this.callStack.push(name);
    }

    popCall() {
        return this.callStack.pop();
    }

    pushCurrentCallable(callable) {
        this.currentCallables.push(callable);
    }

    popCurrentCallable() {
        return this.currentCallables.pop();
    }

    getCurrentCallable() {
        if (this.currentCallables.length === 0) {
            return undefined;
        }
        return this.currentCallables[this.currentCallables.length - 1];
    }

    // --- Environment ---

    getEnv(key, defaultValue) {
        return this.env.has(key) ? this.env.get(key) : defaultValue;
    }

    setEnv(key, value) {
        this.env.set(key, value);
    }

    /**
     * Create a child context (shares global scope and functions but has
     * independent local scopes).
     */
    child() {
        const child = new Context();
        child.globalScope = this.globalScope;
        child.functions = this.functions;
        child.env = this.env;
        child.callStack = [...this.callStack];
        child.currentCallables = [...this.currentCallables];
        child.sharedBodyOverrides = [...this.sharedBodyOverrides];
        return child;
    }

    /**
     * Allow the immediate evaluation of a top-level block-like function body
     * to share the current scope once. Nested blocks are unaffected.
     */
    withSharedBody(bodyNode, callback) {
        const sharedFns = new Set(["BLOCK", "LOOP", "SYSTEM"]);
        if (!bodyNode || !sharedFns.has(bodyNode.fn)) {
            return callback();
        }
        const token = { fn: bodyNode.fn, consumed: false };
        this.sharedBodyOverrides.push(token);
        try {
            return callback();
        } finally {
            if (!token.consumed) {
                this.sharedBodyOverrides.pop();
            }
        }
    }

    consumeSharedBody(fnName) {
        const token = this.sharedBodyOverrides[this.sharedBodyOverrides.length - 1];
        if (!token || token.consumed || token.fn !== fnName) {
            return false;
        }
        token.consumed = true;
        this.sharedBodyOverrides.pop();
        return true;
    }

    /**
     * Clear all non-environment state.
     */
    clear() {
        this.globalScope.clear();
        this.localScopes = [];
        this.functions.clear();
        this.callStack = [];
        this.currentCallables = [];
    }

    /**
     * Get all variable and function names defined in the context.
     */
    getAllNames() {
        const names = new Set([
            ...this.globalScope.keys(),
            ...this.functions.keys(),
        ]);
        return Array.from(names).sort();
    }
}
