/**
 * Evaluation Context
 *
 * Manages the scope chain for variable storage during evaluation.
 * The scope chain is a stack of Map objects. Variable lookup walks
 * from innermost (top) to outermost (bottom / global).
 */

export class Context {
    constructor() {
        // Global scope is always the bottom of the chain
        this.globalScope = new Map();
        // Stack of local scopes (innermost = last element)
        // Each entry is { bindings: Map, isolated: boolean }.
        // Isolated scopes act as lookup barriers for plain identifiers.
        this.localScopes = [];
        // User-defined functions: name → { params, body, closure }
        this.functions = new Map();
        // Environment config
        this.env = new Map();
        // Call stack for debugging
        this.callStack = [];
        // One-shot overrides for top-level function/lambda bodies that should
        // reuse the current local scope instead of creating a nested block scope.
        this.sharedBodyOverrides = [];
    }

    // --- Scope management ---

    /**
     * Push a new local scope (e.g. entering a function or block).
     * @param {Map|Object} [initial] - Optional initial bindings
     * @returns {Map} The new scope
     */
    push(initial, options = {}) {
        const bindings =
            initial instanceof Map
                ? initial
                : new Map(initial ? Object.entries(initial) : []);
        const scope = {
            bindings,
            isolated: options.isolated === true,
        };
        this.localScopes.push(scope);
        return bindings;
    }

    /**
     * Pop the innermost local scope.
     * @returns {Map} The removed scope
     */
    pop() {
        return this.localScopes.pop();
    }

    /**
     * Get a variable value, searching from innermost scope outward.
     * @param {string} name
     * @returns {*} The value, or undefined if not found
     */
    get(name) {
        let blockedByIsolation = false;
        // Search local scopes from innermost to outermost
        for (let i = this.localScopes.length - 1; i >= 0; i--) {
            const scope = this.localScopes[i];
            if (scope.bindings.has(name)) {
                return scope.bindings.get(name);
            }
            if (scope.isolated) {
                blockedByIsolation = true;
                break;
            }
        }
        if (blockedByIsolation) return undefined;
        // Fall back to global
        if (this.globalScope.has(name)) {
            return this.globalScope.get(name);
        }
        // Check functions (uppercase names)
        if (this.functions.has(name)) {
            return this.functions.get(name);
        }
        return undefined;
    }

    /**
     * Set a variable in the current (innermost) scope.
     * If no local scope exists, sets in global scope.
     * @param {string} name
     * @param {*} value
     */
    set(name, value) {
        if (this.localScopes.length > 0) {
            this.localScopes[this.localScopes.length - 1].bindings.set(name, value);
        } else {
            this.globalScope.set(name, value);
        }
    }

    /**
     * Set a variable in the global scope regardless of local scopes.
     */
    setGlobal(name, value) {
        this.globalScope.set(name, value);
    }

    /**
     * Get a variable value from the outer scopes (skipping the innermost local scope).
     * @param {string} name 
     */
    getOuter(name) {
        // Search local scopes from second-innermost to outermost
        for (let i = this.localScopes.length - 2; i >= 0; i--) {
            const scope = this.localScopes[i];
            if (scope.bindings.has(name)) {
                return scope.bindings.get(name);
            }
        }
        // Fall back to global
        if (this.globalScope.has(name)) {
            return this.globalScope.get(name);
        }
        // Check functions
        if (this.functions.has(name)) {
            return this.functions.get(name);
        }
        return undefined;
    }

    /**
     * Set a variable value in an outer scope where it already exists (skipping innermost).
     * If the variable doesn't exist anywhere in the outer scopes (or global), an error is thrown.
     */
    setOuter(name, value) {
        for (let i = this.localScopes.length - 2; i >= 0; i--) {
            const scope = this.localScopes[i];
            if (scope.bindings.has(name)) {
                scope.bindings.set(name, value);
                return;
            }
        }
        if (this.globalScope.has(name)) {
            this.globalScope.set(name, value);
            return;
        }
        throw new Error(`Cannot assign to outer variable '@${name}' because it does not exist in any outer scope.`);
    }

    /**
     * Check if a variable exists in any scope.
     */
    has(name) {
        let blockedByIsolation = false;
        for (let i = this.localScopes.length - 1; i >= 0; i--) {
            const scope = this.localScopes[i];
            if (scope.bindings.has(name)) return true;
            if (scope.isolated) {
                blockedByIsolation = true;
                break;
            }
        }
        if (blockedByIsolation) return false;
        return this.globalScope.has(name) || this.functions.has(name);
    }

    /**
     * Define a user function.
     * @param {string} name
     * @param {Object} funcDef - { params, body, closure? }
     */
    defineFunction(name, funcDef) {
        this.functions.set(name, funcDef);
        // Also set in current scope so it can be retrieved
        this.set(name, funcDef);
    }

    /**
     * Get a user function definition.
     */
    getFunction(name) {
        return this.functions.get(name);
    }

    // --- Call stack ---

    pushCall(name) {
        this.callStack.push(name);
    }

    popCall() {
        return this.callStack.pop();
    }

    // --- Environment ---

    getEnv(key, defaultValue) {
        return this.env.has(key) ? this.env.get(key) : defaultValue;
    }

    setEnv(key, value) {
        this.env.set(key, value);
    }

    /**
     * Create a child context (shares global scope but has independent local scopes).
     * Useful for function calls that need their own scope chain.
     */
    child() {
        const child = new Context();
        child.globalScope = this.globalScope;
        child.functions = this.functions;
        child.env = this.env;
        child.callStack = [...this.callStack];
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
    }

    /**
     * Get all variable and function names defined in the context.
     */
    getAllNames() {
        const names = new Set([
            ...this.globalScope.keys(),
            ...this.functions.keys()
        ]);
        return Array.from(names).sort();
    }
}
