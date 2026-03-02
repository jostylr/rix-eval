/**
 * RiX Lowering Pass: AST → IR
 *
 * Converts parser AST nodes into a flat IR tree of system function calls.
 * Every IR node has the form: { fn: "NAME", args: [...] }
 *
 * This is the bridge between parsing and evaluation.
 */

import { ir } from "./ir.js";

// Operator → system function mapping
const BINARY_OP_MAP = {
  "+": "ADD",
  "-": "SUB",
  "*": "MUL",
  "/": "DIV",
  "//": "INTDIV",
  "%": "MOD",
  "^": "POW",
  "==": "EQ",
  "!=": "NEQ",
  "<": "LT",
  ">": "GT",
  "<=": "LTE",
  ">=": "GTE",
  "?=": "EQ",
  "?<": "LT",
  "?>": "GT",
  "?<=": "LTE",
  "?>=": "GTE",
  "AND": "AND",
  "&&": "AND",
  "OR": "OR",
  "||": "OR",
  "\\/": "UNION",
  "/\\": "INTERSECT",
  "\\": "SET_DIFF",
  "<>": "SET_SYMDIFF",
  "?": "MEMBER",
  "!?": "NOT_MEMBER",
  "?&": "INTERSECTS",
  "++": "CONCAT",
  "**": "SET_PROD",
  "/^": "DIVUP",
  "/~": "DIVROUND",
  "/%": "DIVMOD",
};

/**
 * Lower an array of AST statements into an array of IR nodes.
 */
export function lower(ast) {
  if (!Array.isArray(ast)) {
    return lowerNode(ast);
  }
  return ast.map(lowerNode);
}

/**
 * Lower a single AST node into an IR node.
 */
export function lowerNode(node) {
  if (!node || !node.type) {
    return node;
  }

  const handler = LOWERERS[node.type];
  if (!handler) {
    throw new Error(`Unknown AST node type: ${node.type}`);
  }
  const result = handler(node);
  if (result && typeof result === "object" && !Array.isArray(result) && node.pos) {
    result.pos = node.pos;
  }
  return result;
}

// Per-node-type lowering functions
const LOWERERS = {
  // === Literals & Identifiers ===

  Number(node) {
    if (node.value && node.value.includes(":")) {
      const parts = node.value.split(":");
      return ir("INTERVAL", ...parts.map(p => ir("LITERAL", p)));
    }
    return ir("LITERAL", node.value);
  },

  String(node) {
    return ir("STRING", node.value);
  },

  RegexLiteral(node) {
    const modeMap = {
      "ONE": 0,
      "TEST": 1,
      "ALL": 2,
      "ITER": 3
    };
    return ir(
      "REGEX",
      ir("STRING", node.pattern),
      ir("STRING", node.flags),
      ir("LITERAL", modeMap[node.mode] || 0)
    );
  },

  NULL() {
    return ir("NULL");
  },

  UserIdentifier(node) {
    return ir("RETRIEVE", node.name);
  },

  SystemIdentifier(node) {
    if (node.original && node.original.trim().startsWith("@")) {
      return ir("SYSREF", node.name);
    }
    return ir("RETRIEVE", node.name);
  },

  OuterIdentifier(node) {
    return ir("OUTER_RETRIEVE", node.name);
  },

  SystemFunctionRef(node) {
    return ir("SYSREF", node.name);
  },

  PlaceHolder(node) {
    return ir("PLACEHOLDER", node.place);
  },

  // === Statements ===

  Statement(node) {
    return lowerNode(node.expression);
  },

  Comment() {
    return ir("NOP");
  },

  // === Arithmetic & Binary Operations ===

  BinaryOperation(node) {
    const op = node.operator;

    // Assignment operators
    if (op === "=" || op === ":=") {
      return lowerAssignment(node);
    }

    // Bulk meta merge
    if (op === ".=") {
      return ir("META_MERGE", lowerNode(node.left), lowerNode(node.right));
    }

    // Combo assignment operators
    const comboOpMap = {
      "+=": true,
      "-=": true,
      "*=": true,
      "/=": true,
      "//=": true,
      "%=": true,
      "^=": true,
      "**=": true,
    };

    if (comboOpMap[op]) {
      // De-sugar exactly as `left = left OP right`
      // Create a virtual AST node for the `left OP right` math operation
      const mathOpStr = op.slice(0, -1); // Remove '='
      const mathAstNode = {
        type: "BinaryOperation",
        operator: mathOpStr,
        left: node.left,
        right: node.right,
        pos: node.pos,
      };

      // Create a virtual AST node for `left = mathAstNode`
      const assignAstNode = {
        type: "BinaryOperation",
        operator: "=",
        left: node.left,
        right: mathAstNode,
        pos: node.pos,
      };

      return lowerAssignment(assignAstNode);
    }
    if (op === ":=:") {
      const left = node.left;
      if (left.type === "UserIdentifier" || left.type === "SystemIdentifier") {
        return ir("SOLVE", left.name, lowerNode(node.right));
      }
      return ir("SOLVE", lowerNode(left), lowerNode(node.right));
    }
    if (op === ":<:") {
      return ir("ASSERT_LT", lowerNode(node.left), lowerNode(node.right));
    }
    if (op === ":>:") {
      return ir("ASSERT_GT", lowerNode(node.left), lowerNode(node.right));
    }
    if (op === ":>=:") {
      return ir("ASSERT_GTE", lowerNode(node.left), lowerNode(node.right));
    }
    if (op === ":<=:") {
      return ir("ASSERT_LTE", lowerNode(node.left), lowerNode(node.right));
    }

    if (op === ":") {
      const args = [];
      const extractArgs = (n) => {
        if (n && n.type === "BinaryOperation" && n.operator === ":") {
          extractArgs(n.left);
          extractArgs(n.right);
        } else {
          const lowered = lowerNode(n);
          // If it lowered to an INTERVAL IR node, flatten it
          if (lowered && typeof lowered === "object" && lowered.fn === "INTERVAL") {
            args.push(...lowered.args);
          } else {
            args.push(lowered);
          }
        }
      };
      extractArgs(node.left);
      extractArgs(node.right);
      return ir("INTERVAL", ...args);
    }

    // Base conversion operators
    if (op === "_>") {
      return ir("TOBASE", lowerNode(node.left), lowerNode(node.right));
    }
    if (op === "<_") {
      return ir("FROMBASE", lowerNode(node.left), lowerNode(node.right));
    }

    // Standard binary ops
    const sysFn = BINARY_OP_MAP[op];
    if (sysFn) {
      return ir(sysFn, lowerNode(node.left), lowerNode(node.right));
    }

    // Pipe variants handled as binary ops
    if (op.startsWith("|")) {
      return ir("PIPE_OP", op, lowerNode(node.left), lowerNode(node.right));
    }

    // Arrow operator -> used as alias for :-> in named function definitions
    // F(x) -> body  is equivalent to  F(x) :-> body  (same as = vs :=)
    // Detect: left is a FunctionCall with known name
    if (op === "->") {
      const left = node.left;
      if (left.type === "FunctionCall" && left.function) {
        const fn = left.function;
        const funcName = fn.name || fn.value;
        if (funcName) {
          // Convert call-style args to param definitions
          const positionalArgs = (left.arguments?.positional || []);
          const paramPosArgs = positionalArgs.map((arg) => ({
            name: arg.name || arg.value || String(arg),
            defaultValue: null,
          }));
          const params = lowerParams({
            positional: paramPosArgs,
            keyword: [],
            conditionals: [],
            metadata: {},
          });
          const body = lowerNode(node.right);
          return ir("FUNCDEF", funcName, params, body);
        }
      }
      // Otherwise treat as lambda: (params) -> body is FunctionLambda, but
      // if we get here it means an unrecognized left, fall through to BINOP
    }

    // Fallback: generic binary operation
    return ir("BINOP", op, lowerNode(node.left), lowerNode(node.right));
  },

  UnaryOperation(node) {
    if (node.operator === "-") {
      return ir("NEG", lowerNode(node.operand));
    }
    if (node.operator === "+") {
      return lowerNode(node.operand); // unary + is identity
    }
    if (node.operator === "NOT" || node.operator === "!") {
      return ir("NOT", lowerNode(node.operand));
    }
    return ir("UNARY", node.operator, lowerNode(node.operand));
  },

  ImplicitMultiplication(node) {
    return ir("MUL", lowerNode(node.left), lowerNode(node.right));
  },

  // === Function Calls ===

  FunctionCall(node) {
    const fn = node.function;
    const args = lowerCallArgs(node.arguments);

    if (fn.type === "SystemIdentifier" || fn.type === "UserIdentifier") {
      const name = fn.name;
      // Handle operators parsed as function calls due to parser ambiguity/overloading rules
      if (args.length === 1) {
        if (name === "-") return ir("NEG", args[0]);
        if (name === "+") return args[0]; // unary + is identity
        if (name === "!" || name === "NOT") return ir("NOT", args[0]);
      } else if (args.length === 2) {
        if (name === "+") return ir("ADD", args[0], args[1]);
        if (name === "-") return ir("SUB", args[0], args[1]);
        if (name === "*") return ir("MUL", args[0], args[1]);
        if (name === "/") return ir("DIV", args[0], args[1]);
      }
      return ir("CALL", name, ...args);
    }
    // Expression call: (expr)(args)
    return ir("CALL_EXPR", lowerNode(fn), ...args);
  },

  SystemCall(node) {
    const args = lowerCallArgs(node.arguments);
    return ir(node.name, ...args);
  },

  Call(node) {
    const args = lowerCallArgs(node.arguments);
    const target = node.target;
    // Method call: expr.method(args) → CALL_EXPR(META_GET(expr,"method"), expr, ...args)
    if (target.type === "DotAccess") {
      const objIR = lowerNode(target.object);
      return ir("CALL_EXPR", ir("META_GET", objIR, target.property), objIR, ...args);
    }
    return ir("CALL_EXPR", lowerNode(target), ...args);
  },

  CommandCall(node) {
    const name = node.command.name;
    const args = node.arguments.map(lowerNode);
    return ir("COMMAND", name, ...args);
  },

  // === Function Definitions ===

  FunctionDefinition(node) {
    const name = node.name.name || node.name.value;
    const params = lowerParams(node.parameters);
    const body = lowerNode(node.body);
    return ir("FUNCDEF", name, params, body);
  },

  FunctionLambda(node) {
    const params = lowerParams(node.parameters);
    const body = lowerNode(node.body);
    return ir("LAMBDA", params, body);
  },

  PatternMatchingFunction(node) {
    const name = node.name.name || node.name.value;
    const patterns = node.patterns.map((p) => ({
      params: lowerParams(p.parameters),
      body: lowerNode(p.body),
    }));
    return ir("PATTERNDEF", name, patterns);
  },

  // === Grouping ===

  Grouping(node) {
    if (node.expression) {
      return lowerNode(node.expression);
    }
    return ir("NULL");
  },

  Tuple(node) {
    return ir("TUPLE", ...node.elements.map(lowerNode));
  },

  ParameterList(node) {
    return lowerParams(node.parameters);
  },

  // === Collections ===

  Array(node) {
    return ir("ARRAY", ...node.elements.map(lowerNode));
  },

  Matrix(node) {
    const rows = node.rows.map((row) => ir("ARRAY", ...row.map(lowerNode)));
    return ir("MATRIX", ...rows);
  },

  Tensor(node) {
    return ir("TENSOR", ...node.elements.map(lowerNode));
  },

  // === Brace Sigil Containers ===

  MapContainer(node) {
    return ir("MAP_OBJ", ...node.elements.map(lowerNode));
  },

  CaseContainer(node) {
    return ir("CASE", ...node.elements.map((el) => ir("DEFER", lowerNode(el))));
  },

  BlockContainer(node) {
    return ir("BLOCK", ...node.elements.map(lowerNode));
  },

  SetContainer(node) {
    return ir("SET", ...node.elements.map(lowerNode));
  },

  TupleContainer(node) {
    return ir("TUPLE", ...node.elements.map(lowerNode));
  },

  LoopContainer(node) {
    return ir("LOOP", ...node.elements.map((el) => ir("DEFER", lowerNode(el))));
  },

  SystemContainer(node) {
    return ir("SYSTEM", ...node.elements.map(lowerNode));
  },


  // === Deferred Blocks ===

  DeferredBlock(node) {
    return ir("DEFER", lowerNode(node.body));
  },

  // === Property Access ===

  DotAccess(node) {
    return ir("META_GET", lowerNode(node.object), node.property);
  },

  PropertyAccess(node) {
    const obj = lowerNode(node.object);
    if (node.property && node.property.type === "KeyLiteral") {
      // [:name] sugar — pass string key directly
      return ir("INDEX_GET", obj, node.property.name);
    }
    return ir("INDEX_GET", obj, lowerNode(node.property));
  },

  ExternalAccess(node) {
    // node.property === null always now (a..name is parse error)
    return ir("META_ALL", lowerNode(node.object));
  },

  KeySet(node) {
    return ir("KEYS", lowerNode(node.object));
  },

  ValueSet(node) {
    return ir("VALUES", lowerNode(node.object));
  },

  // === Mutation ===

  Mutation(node) {
    const target = lowerNode(node.target);
    const ops = node.operations.map((op) => ({
      action: op.action,
      key: op.key,
      value: op.value ? lowerNode(op.value) : null,
    }));
    const fn = node.mutate ? "MUTINPLACE" : "MUTCOPY";
    return ir(fn, target, ops);
  },

  // === Pipes ===

  Pipe(node) {
    return ir("PIPE", lowerNode(node.left), lowerNode(node.right));
  },

  ExplicitPipe(node) {
    return ir("PIPE_EXPLICIT", lowerNode(node.left), lowerNode(node.right));
  },

  SliceStrict(node) {
    return ir("PSLICE_STRICT", lowerNode(node.left), lowerNode(node.right));
  },

  SliceClamp(node) {
    return ir("PSLICE_CLAMP", lowerNode(node.left), lowerNode(node.right));
  },

  Split(node) {
    return ir("PSPLIT", lowerNode(node.left), lowerNode(node.right));
  },

  Chunk(node) {
    return ir("PCHUNK", lowerNode(node.left), lowerNode(node.right));
  },

  Map(node) {
    return ir("PMAP", lowerNode(node.left), lowerNode(node.right));
  },

  Filter(node) {
    return ir("PFILTER", lowerNode(node.left), lowerNode(node.right));
  },

  Every(node) {
    return ir("PALL", lowerNode(node.left), lowerNode(node.right));
  },

  Some(node) {
    return ir("PANY", lowerNode(node.left), lowerNode(node.right));
  },

  Reduce(node) {
    if (node.init) {
      return ir("PREDUCE", lowerNode(node.left), lowerNode(node.right), lowerNode(node.init));
    }
    return ir("PREDUCE", lowerNode(node.left), lowerNode(node.right));
  },

  Reverse(node) {
    return ir("PREVERSE", lowerNode(node.target));
  },

  Sort(node) {
    return ir("PSORT", lowerNode(node.left), lowerNode(node.right));
  },

  // === Ternary ===

  TernaryOperation(node) {
    return ir(
      "TERNARY",
      lowerNode(node.condition),
      ir("DEFER", lowerNode(node.trueExpression)),
      ir("DEFER", lowerNode(node.falseExpression)),
    );
  },

  // === Postfix Operators ===

  At(node) {
    return ir("AT", lowerNode(node.target), lowerNode(node.arg));
  },

  Ask(node) {
    return ir("ASK", lowerNode(node.target), lowerNode(node.arg));
  },

  // === Calculus ===

  Derivative(node) {
    return ir("DERIVATIVE", lowerNode(node.function), node.order);
  },

  Integral(node) {
    return ir("INTEGRAL", lowerNode(node.expression));
  },

  // === Interval Operations ===

  IntervalStepping(node) {
    return ir("STEP", lowerNode(node.interval), lowerNode(node.step));
  },

  IntervalDivision(node) {
    return ir("DIVIDE", lowerNode(node.interval), lowerNode(node.count));
  },

  IntervalPartition(node) {
    return ir("PARTITION", lowerNode(node.interval), lowerNode(node.count));
  },

  IntervalMediants(node) {
    return ir("MEDIANTS", lowerNode(node.interval), lowerNode(node.levels));
  },

  IntervalMediantPartition(node) {
    return ir(
      "MEDIANT_PARTITION",
      lowerNode(node.interval),
      lowerNode(node.levels),
    );
  },

  IntervalRandom(node) {
    return ir("RANDOM", lowerNode(node.interval), lowerNode(node.count));
  },

  IntervalRandomPartition(node) {
    return ir(
      "RANDOM_PARTITION",
      lowerNode(node.interval),
      lowerNode(node.count),
    );
  },

  InfiniteSequence(node) {
    return ir(
      "INFSEQ",
      lowerNode(node.start),
      node.step ? lowerNode(node.step) : null,
    );
  },

  // === Units ===

  ScientificUnit(node) {
    return ir("UNIT", lowerNode(node.expression), node.unit);
  },

  MathematicalUnit(node) {
    return ir("MATHUNIT", lowerNode(node.expression), node.unit);
  },

  // === Generators ===

  GeneratorChain(node) {
    const start = node.start ? lowerNode(node.start) : null;
    const ops = node.operators.map(lowerNode);
    return ir("GENERATOR", start, ...ops);
  },

  GeneratorAdd(node) { return ir("GEN_ADD", lowerNode(node.operand)); },
  GeneratorMultiply(node) { return ir("GEN_MUL", lowerNode(node.operand)); },
  GeneratorFunction(node) { return ir("GEN_FUNC", lowerNode(node.operand)); },
  GeneratorFilter(node) { return ir("GEN_FILTER", lowerNode(node.operand)); },
  GeneratorLimit(node) { return ir("GEN_LIMIT", lowerNode(node.operand)); },
  GeneratorLazyLimit(node) { return ir("GEN_LAZY_LIMIT", lowerNode(node.operand)); },
  GeneratorEagerLimit(node) { return ir("GEN_EAGER_LIMIT", lowerNode(node.operand)); },
  GeneratorPipe(node) { return ir("GEN_PIPE", lowerNode(node.operand)); },

  // === Metadata ===

  WithMetadata(node) {
    const expr = lowerNode(node.expression);
    const meta = {};
    for (const [key, value] of Object.entries(node.metadata)) {
      meta[key] = lowerNode(value);
    }
    return ir("WITH_META", expr, meta);
  },

  // === Embedded Language ===

  EmbeddedLanguage(node) {
    return ir("EMBEDDED", node.language, node.code);
  },
};

// === Helper Functions ===

/**
 * Lower assignment: x = expr or F(x) = expr
 */
function lowerAssignment(node) {
  const left = node.left;

  // Base prefix definition assignment: 0A = ...
  if (left.type === "Number" && typeof left.value === "string") {
    const m = left.value.match(/^0([A-Z])$/);
    if (m) {
      return ir("DEFINEBASE", m[1], lowerNode(node.right));
    }
  }

  // Outer variable assignment: @a = 5
  if (left.type === "OuterIdentifier") {
    return ir("OUTER_ASSIGN", left.name, lowerNode(node.right));
  }

  // Simple variable assignment: x = 5
  if (left.type === "UserIdentifier" || left.type === "SystemIdentifier") {
    return ir("ASSIGN", left.name, lowerNode(node.right));
  }

  // Meta assignment: obj.name = val
  if (left.type === "DotAccess") {
    return ir(
      "META_SET",
      lowerNode(left.object),
      left.property,
      lowerNode(node.right),
    );
  }

  // ExternalAccess assignment: a..prop = val is no longer valid
  if (left.type === "ExternalAccess") {
    throw new Error("a..prop assignment is no longer supported; use a.prop = val for meta access");
  }

  // Index assignment: arr[i] = val (with KeyLiteral support)
  if (left.type === "PropertyAccess") {
    const obj = lowerNode(left.object);
    if (left.property && left.property.type === "KeyLiteral") {
      return ir("INDEX_SET", obj, left.property.name, lowerNode(node.right));
    }
    return ir(
      "INDEX_SET",
      obj,
      lowerNode(left.property),
      lowerNode(node.right),
    );
  }

  // Fallback: generic assignment expression
  return ir("ASSIGN_EXPR", lowerNode(left), lowerNode(node.right));
}

/**
 * Lower function call arguments { positional: [...], keyword: {...} }
 * into a flat array of IR nodes, with keyword args as KWARG nodes.
 */
function lowerCallArgs(args) {
  if (!args) return [];

  const result = [];

  // Positional args
  if (args.positional) {
    for (const arg of args.positional) {
      result.push(lowerNode(arg));
    }
  }

  // Keyword args
  if (args.keyword) {
    for (const [key, value] of Object.entries(args.keyword)) {
      result.push(ir("KWARG", key, lowerNode(value)));
    }
  }

  return result;
}

/**
 * Lower parameter definitions into a serializable format.
 */
function lowerParams(params) {
  if (!params) return { positional: [], keyword: [], conditionals: [] };

  return {
    positional: (params.positional || []).map((p) => ({
      name: p.name,
      default: p.defaultValue ? lowerNode(p.defaultValue) : null,
    })),
    keyword: (params.keyword || []).map((p) => ({
      name: p.name,
      default: p.defaultValue ? lowerNode(p.defaultValue) : null,
    })),
    conditionals: (params.conditionals || []).map(lowerNode),
    metadata: params.metadata || {},
  };
}
