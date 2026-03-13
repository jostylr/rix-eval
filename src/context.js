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
        this.currentCallables = [];
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
            aliases: new Map(),
            isolated: options.isolated === true,
            readThrough: options.readThrough === true,
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
        const ref = this.resolveBinding(name);
        if (ref) {
            return ref.map.get(ref.name);
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
            const scope = this.localScopes[this.localScopes.length - 1];
            const aliasRef = scope.aliases.get(name);
            if (aliasRef) {
                aliasRef.map.set(aliasRef.name, value);
                return;
            }
            scope.bindings.set(name, value);
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
        const ref = this.resolveBinding(name, { skipInnermost: true, respectIsolation: false });
        if (ref) {
            return ref.map.get(ref.name);
        }
        return undefined;
    }

    /**
     * Set a variable value in an outer scope where it already exists (skipping innermost).
     * If the variable doesn't exist anywhere in the outer scopes (or global), an error is thrown.
     */
    setOuter(name, value) {
        const ref = this.resolveBinding(name, { skipInnermost: true, respectIsolation: false });
        if (ref) {
            ref.map.set(ref.name, value);
            return;
        }
        throw new Error(`Cannot assign to outer variable '@${name}' because it does not exist in any outer scope.`);
    }

    /**
     * Check if a variable exists in any scope.
     */
    has(name) {
        return Boolean(this.resolveBinding(name));
    }

    getCallable(name) {
        const ref = this.resolveBinding(name, { respectIsolation: false });
        if (ref) {
            return ref.map.get(ref.name);
        }
        if (this.functions.has(name)) {
            return this.functions.get(name);
        }
        return undefined;
    }

    resolveBinding(name, options = {}) {
        const skipInnermost = options.skipInnermost === true;
        const respectIsolation = options.respectIsolation !== false;
        const startIndex = this.localScopes.length - 1 - (skipInnermost ? 1 : 0);

        for (let i = startIndex; i >= 0; i--) {
            const scope = this.localScopes[i];
            const ref = this.resolveBindingInScope(scope, name);
            if (ref) {
                return ref;
            }
            if (scope.readThrough) {
                const outerScope = this.localScopes[i - 1];
                if (outerScope) {
                    return this.resolveBindingInScope(outerScope, name);
                }
                if (this.globalScope.has(name)) {
                    return { map: this.globalScope, name };
                }
                return null;
            }
            if (respectIsolation && scope.isolated) {
                return null;
            }
        }

        if (this.globalScope.has(name)) {
            return { map: this.globalScope, name };
        }

        return null;
    }

    resolveBindingInScope(scope, name) {
        if (scope.bindings.has(name)) {
            return { map: scope.bindings, name };
        }
        if (scope.aliases.has(name)) {
            return scope.aliases.get(name);
        }
        return null;
    }

    importCopy(localName, sourceName) {
        if (this.localScopes.length === 0) {
            throw new Error("Import headers require an active local scope");
        }
        const ref = this.resolveBinding(sourceName, { skipInnermost: true, respectIsolation: false });
        if (!ref) {
            throw new Error(`Undefined outer variable for import: ${sourceName}`);
        }
        const scope = this.localScopes[this.localScopes.length - 1];
        scope.bindings.set(localName, ref.map.get(ref.name));
    }

    importAlias(localName, sourceName) {
        if (this.localScopes.length === 0) {
            throw new Error("Import headers require an active local scope");
        }
        const ref = this.resolveBinding(sourceName, { skipInnermost: true, respectIsolation: false });
        if (!ref) {
            throw new Error(`Undefined outer variable for import alias: ${sourceName}`);
        }
        const scope = this.localScopes[this.localScopes.length - 1];
        scope.aliases.set(localName, ref);
    }

    /**
     * Define a user function.
     * @param {string} name
     * @param {Object} funcDef - { params, body, closure? }
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
     * Create a child context (shares global scope but has independent local scopes).
     * Useful for function calls that need their own scope chain.
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
            ...this.functions.keys()
        ]);
        return Array.from(names).sort();
    }
}
