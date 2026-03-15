import { describe, test, expect } from "bun:test";
import { tokenize } from "../../parser/src/tokenizer.js";
import { parse } from "../../parser/src/parser.js";
import { lower, lowerNode } from "../src/lower.js";

function testSystemLookup(name) {
  const systemSymbols = {
    SIN: { type: "function", arity: 1 },
    COS: { type: "function", arity: 1 },
    LOG: { type: "function", arity: 1 },
    MAX: { type: "function", arity: -1 },
    PI: { type: "constant", value: Math.PI },
    E: { type: "constant", value: Math.E },
    AND: { type: "operator", precedence: 40, associativity: "left", operatorType: "infix" },
    OR: { type: "operator", precedence: 30, associativity: "left", operatorType: "infix" },
    NOT: { type: "operator", precedence: 110, operatorType: "prefix" },
    HELP: { type: "identifier" },
    LOAD: { type: "identifier" },
    CASE: { type: "identifier" },
    LOOP: { type: "identifier" },
    IF: { type: "identifier" },
    F: { type: "identifier" },
    G: { type: "identifier" },
  };
  return systemSymbols[name] || { type: "identifier" };
}

function parseAndLower(code) {
  const tokens = tokenize(code);
  const ast = parse(tokens, testSystemLookup);
  return lower(ast);
}

function L(code) {
  const result = parseAndLower(code);
  const stripped = strip(result);
  // Return first IR node (unwrapping single-element arrays)
  return stripped.length === 1 ? stripped[0] : stripped;
}

// Strip pos/original metadata for cleaner comparisons
function strip(obj) {
  if (Array.isArray(obj)) return obj.map(strip);
  if (obj && typeof obj === "object") {
    const { pos, original, ...rest } = obj;
    const result = {};
    for (const [key, value] of Object.entries(rest)) {
      result[key] = strip(value);
    }
    return result;
  }
  return obj;
}

describe("Lowering Pass", () => {
  describe("Literals", () => {
    test("integer", () => {
      const ir = L("42;");
      expect(ir).toEqual({ fn: "LITERAL", args: ["42"] });
    });

    test("rational", () => {
      const ir = L("3/4;");
      expect(ir).toEqual({ fn: "LITERAL", args: ["3/4"] });
    });

    test("string", () => {
      const ir = L('"hello";');
      expect(ir).toEqual({ fn: "STRING", args: ["hello"] });
    });

    test("null", () => {
      const ir = L("_;");
      expect(ir).toEqual({ fn: "NULL", args: [] });
    });

    test("base prefix number", () => {
      const ir = L("0xFF;");
      expect(ir).toEqual({ fn: "LITERAL", args: ["0xFF"] });
    });
  });

  describe("Variables", () => {
    test("lowercase identifier → RETRIEVE", () => {
      const ir = L("x;");
      expect(ir).toEqual({ fn: "RETRIEVE", args: ["x"] });
    });

    test("uppercase identifier → RETRIEVE", () => {
      const ir = L("PI;");
      expect(ir).toEqual({ fn: "RETRIEVE", args: ["PI"] });
    });

    test("placeholder → PLACEHOLDER", () => {
      const ir = L("_1;");
      expect(ir).toEqual({ fn: "PLACEHOLDER", args: [1] });
    });
  });

  describe("Assignment", () => {
    test("x = 5", () => {
      const ir = L("x = 5;");
      expect(ir).toEqual({
        fn: "ASSIGN",
        args: ["x", { fn: "LITERAL", args: ["5"] }],
      });
    });

    test("x := 5 produces ASSIGN_COPY", () => {
      const ir = L("x := 5;");
      expect(ir).toEqual({
        fn: "ASSIGN_COPY",
        args: ["x", { fn: "LITERAL", args: ["5"] }],
      });
    });

    test("chained assignment x = y = 3", () => {
      const ir = L("x = y = 3;");
      expect(ir.fn).toBe("ASSIGN");
      expect(ir.args[0]).toBe("x");
      expect(ir.args[1].fn).toBe("ASSIGN");
      expect(ir.args[1].args[0]).toBe("y");
    });

    test("meta assignment obj.a = 7 → META_SET", () => {
      const ir = L("obj.a = 7;");
      expect(ir.fn).toBe("META_SET");
      expect(ir.args[1]).toBe("a");
    });

    test("index assignment arr[i] = val → INDEX_SET", () => {
      const ir = L("arr[i] = val;");
      expect(ir.fn).toBe("INDEX_SET");
    });

    test("key literal index assignment obj[:foo] = val → INDEX_SET with string key", () => {
      const ir = L("obj[:foo] = val;");
      expect(ir.fn).toBe("INDEX_SET");
      expect(ir.args[1]).toBe("foo");
    });

    test("method call arr.Push(1) desugars to CALL_EXPR(META_GET(...))", () => {
      const ir = L("arr.PUSH(1);");
      expect(ir.fn).toBe("CALL_EXPR");
      expect(ir.args[0].fn).toBe("META_GET");
      expect(ir.args[0].args[1]).toBe("PUSH");
    });

    test("compound meta assignment obj.x += 1 → META_SET(obj, 'x', ADD(META_GET(obj,'x'), 1))", () => {
      const ir = L("obj.x += 1;");
      expect(ir.fn).toBe("META_SET");
      expect(ir.args[1]).toBe("x");
      expect(ir.args[2].fn).toBe("ADD");
      expect(ir.args[2].args[0].fn).toBe("META_GET");
      expect(ir.args[2].args[0].args[1]).toBe("x");
    });

    test("base definition assignment 0A = \"...\" lowers to DEFINEBASE", () => {
      const ir = L('0A = "0123456789ABCDEF";');
      expect(ir.fn).toBe("DEFINEBASE");
      expect(ir.args[0]).toBe("A");
      expect(ir.args[1]).toEqual({ fn: "STRING", args: ["0123456789ABCDEF"] });
    });
  });

  describe("Arithmetic", () => {
    test("addition", () => {
      const ir = L("a + b;");
      expect(ir.fn).toBe("ADD");
      expect(ir.args[0]).toEqual({ fn: "RETRIEVE", args: ["a"] });
      expect(ir.args[1]).toEqual({ fn: "RETRIEVE", args: ["b"] });
    });

    test("subtraction", () => {
      expect(L("a - b;").fn).toBe("SUB");
    });

    test("multiplication", () => {
      expect(L("a * b;").fn).toBe("MUL");
    });

    test("division", () => {
      expect(L("a / b;").fn).toBe("DIV");
    });

    test("integer division", () => {
      expect(L("a // b;").fn).toBe("INTDIV");
    });

    test("modulo", () => {
      expect(L("a % b;").fn).toBe("MOD");
    });

    test("exponentiation", () => {
      expect(L("a ^ b;").fn).toBe("POW");
    });

    test("nested: 2 + 3 * 4 → ADD(2, MUL(3, 4))", () => {
      const ir = L("2 + 3 * 4;");
      expect(ir.fn).toBe("ADD");
      expect(ir.args[0]).toEqual({ fn: "LITERAL", args: ["2"] });
      expect(ir.args[1].fn).toBe("MUL");
    });

    test("unary minus → NEG", () => {
      const ir = L("-x;");
      expect(ir).toEqual({ fn: "NEG", args: [{ fn: "RETRIEVE", args: ["x"] }] });
    });

    test("unary plus → identity", () => {
      const ir = L("+42;");
      expect(ir).toEqual({ fn: "LITERAL", args: ["42"] });
    });

    test("base conversion operators lower correctly", () => {
      const toIr = L("5 _> 0b;");
      expect(toIr.fn).toBe("TOBASE");

      const fromIr = L('"101" <_ 0b;');
      expect(fromIr.fn).toBe("FROMBASE");
    });
  });

  describe("Comparison & Logic", () => {
    test("equality", () => {
      expect(L("a == b;").fn).toBe("EQ");
    });

    test("not-equal", () => {
      expect(L("a != b;").fn).toBe("NEQ");
    });

    test("less than", () => {
      expect(L("a < b;").fn).toBe("LT");
    });

    test("greater than", () => {
      expect(L("a > b;").fn).toBe("GT");
    });

    test("less-equal", () => {
      expect(L("a <= b;").fn).toBe("LTE");
    });

    test("greater-equal", () => {
      expect(L("a >= b;").fn).toBe("GTE");
    });

    test("interval operator :", () => {
      expect(L("a : b;").fn).toBe("INTERVAL");
    });
  });

  describe("System Specs", () => {
    test("{#x,y:p# p = x + y } lowers to SYSTEM_SPEC", () => {
      const ir = L("{#x,y:p# p = x + y };");
      expect(ir.fn).toBe("SYSTEM_SPEC");
      expect(ir.args[0]).toEqual({
        inputs: ["x", "y"],
        outputs: ["p"],
        outputsDeclared: true,
        statements: [
          {
            kind: "assign",
            target: "p",
            expr: {
              fn: "ADD",
              args: [
                { fn: "RETRIEVE", args: ["x"] },
                { fn: "RETRIEVE", args: ["y"] },
              ],
            },
          },
        ],
      });
    });

    test("{# p = x + 1 } infers outputs during lowering metadata", () => {
      const ir = L("{# p = x + 1 };");
      expect(ir.fn).toBe("SYSTEM_SPEC");
      expect(ir.args[0].outputs).toEqual(["p"]);
      expect(ir.args[0].outputsDeclared).toBe(false);
    });
  });

  describe("Implicit Multiplication", () => {
    test("f(x) → MUL(RETRIEVE(f), RETRIEVE(x))", () => {
      const ir = L("f(x);");
      expect(ir.fn).toBe("MUL");
      expect(ir.args[0]).toEqual({ fn: "RETRIEVE", args: ["f"] });
      // The right side is a Grouping which lowers to just the inner expression
      expect(ir.args[1]).toEqual({ fn: "RETRIEVE", args: ["x"] });
    });

    test("abc(2+3) → MUL(RETRIEVE(abc), ADD(2,3))", () => {
      const ir = L("abc(2+3);");
      expect(ir.fn).toBe("MUL");
      expect(ir.args[1].fn).toBe("ADD");
    });
  });

  describe("Function Calls", () => {
    test("SIN(x) → CALL(SIN, RETRIEVE(x))", () => {
      const ir = L("SIN(x);");
      expect(ir.fn).toBe("CALL");
      expect(ir.args[0]).toBe("SIN");
      expect(ir.args[1]).toEqual({ fn: "RETRIEVE", args: ["x"] });
    });

    test("F(x, y) → CALL(F, ...)", () => {
      const ir = L("F(x, y);");
      expect(ir.fn).toBe("CALL");
      expect(ir.args[0]).toBe("F");
      expect(ir.args.length).toBe(3); // name + 2 args
    });

    test("function with keyword args", () => {
      const ir = L("F(2, 3; a := 4);");
      expect(ir.fn).toBe("CALL");
      expect(ir.args[0]).toBe("F");
      // positional: 2, 3; then keyword: a=4
      const kwarg = ir.args.find((a) => a && a.fn === "KWARG");
      expect(kwarg).toBeDefined();
      expect(kwarg.args[0]).toBe("a");
    });

    test("@_ADD(a, b) → SYS_CALL(ADD, ...) via system context", () => {
      const ir = L("@_ADD(a, b);");
      expect(ir.fn).toBe("SYS_CALL");
      expect(ir.args[0]).toBe("ADD");
      expect(ir.args[1]).toEqual({ fn: "RETRIEVE", args: ["a"] });
      expect(ir.args[2]).toEqual({ fn: "RETRIEVE", args: ["b"] });
    });

    test("@_ASSIGN(x, 5) → SYS_CALL(ASSIGN, ...) via system context", () => {
      const ir = L("@_ASSIGN(x, 5);");
      expect(ir.fn).toBe("SYS_CALL");
      expect(ir.args[0]).toBe("ASSIGN");
    });

  });

  describe("Function Definitions", () => {
    test("f(x) :-> x + 1", () => {
      const ir = L("f(x) :-> x + 1;");
      expect(ir.fn).toBe("FUNCDEF");
      expect(ir.args[0]).toBe("f");
      // params
      expect(ir.args[1].positional[0].name).toBe("x");
      // body
      expect(ir.args[2].fn).toBe("ADD");
    });

    test("F(x) -> x + 1  (-> alias for :->)", () => {
      const ir = L("F(x) -> x + 1;");
      expect(ir.fn).toBe("FUNCDEF");
      // params same as :-> version
      expect(ir.args[1].positional[0].name).toBe("x");
      expect(ir.args[2].fn).toBe("ADD");
    });

    test("Avg(a, b) -> (a+b)/2  (-> multi-arg alias)", () => {
      const ir = L("Avg(a, b) -> (a + b) / 2;");
      expect(ir.fn).toBe("FUNCDEF");
      expect(ir.args[1].positional.length).toBe(2);
      expect(ir.args[1].positional[0].name).toBe("a");
      expect(ir.args[1].positional[1].name).toBe("b");
      expect(ir.args[2].fn).toBe("DIV");
    });

    test("lambda: (x) -> x^2", () => {
      const ir = L("(x) -> x^2;");
      expect(ir.fn).toBe("LAMBDA");
      expect(ir.args[0].positional[0].name).toBe("x");
      expect(ir.args[1].fn).toBe("POW");
    });

    test("function with hole-default params", () => {
      const ir = L("f(x, n ?| 5) :-> x^n;");
      expect(ir.fn).toBe("FUNCDEF");
      const params = ir.args[1];
      expect(params.positional[1].holeDefault.fn).toBe("LITERAL");
      expect(params.positional[1].holeDefault.args[0]).toBe("5");
    });

    test("self reference lowers to SELF inside function bodies", () => {
      const ir = L("(x) -> $;");
      expect(ir.fn).toBe("LAMBDA");
      expect(ir.args[1]).toEqual({ fn: "SELF", args: [] });
    });

    test("tail self call lowers to TAIL_SELF in direct tail position", () => {
      const ir = L("(x) -> $(x - 1);");
      expect(ir.fn).toBe("LAMBDA");
      expect(ir.args[1].fn).toBe("TAIL_SELF");
      expect(ir.args[1].args[0].fn).toBe("SUB");
    });

    test("ternary branches preserve tail position for self calls", () => {
      const ir = L("(x) -> x == 0 ?? $(1) ?: $(x - 1);");
      expect(ir.fn).toBe("LAMBDA");
      expect(ir.args[1].fn).toBe("TERNARY");
      expect(ir.args[1].args[1].args[0].fn).toBe("TAIL_SELF");
      expect(ir.args[1].args[2].args[0].fn).toBe("TAIL_SELF");
    });

    test("non-tail self call stays as an ordinary expression call", () => {
      const ir = L("(x) -> x * $(x - 1);");
      expect(ir.fn).toBe("LAMBDA");
      expect(ir.args[1].fn).toBe("MUL");
      expect(ir.args[1].args[1].fn).toBe("CALL_EXPR");
      expect(ir.args[1].args[1].args[0]).toEqual({ fn: "SELF", args: [] });
    });

    test("self meta access lowers through ordinary meta ops", () => {
      const ir = L("(x) -> ($.label, $..);");
      expect(ir.fn).toBe("LAMBDA");
      expect(ir.args[1].fn).toBe("TUPLE");
      expect(ir.args[1].args[0]).toEqual({
        fn: "META_GET",
        args: [{ fn: "SELF", args: [] }, "label"],
      });
      expect(ir.args[1].args[1]).toEqual({
        fn: "META_ALL",
        args: [{ fn: "SELF", args: [] }],
      });
    });

    test("assigning to bare $ is rejected during lowering", () => {
      expect(() => L("$ = 1;")).toThrow(/Cannot assign to '\$'/);
    });
  });

  describe("Collections", () => {
    test("array [1, 2, 3]", () => {
      const ir = L("[1, 2, 3];");
      expect(ir.fn).toBe("ARRAY");
      expect(ir.args.length).toBe(3);
    });

    test("{| 1, 2, 3 |} → SET", () => {
      const ir = L("{| 1, 2, 3 |};");
      expect(ir.fn).toBe("SET");
      expect(ir.args.length).toBe(3);
    });

    test("{: a, b } → TUPLE", () => {
      const ir = L("{: a, b };");
      expect(ir.fn).toBe("TUPLE");
      expect(ir.args.length).toBe(2);
    });

    test("{= a, b, c } → MAP_OBJ", () => {
      const ir = L("{= a, b, c };");
      expect(ir.fn).toBe("MAP_OBJ");
    });

    test("{= a=1 } lowers identifier key sugar to MAP_PAIR(identifier,...)", () => {
      const ir = L("{= a=1 };");
      expect(ir.fn).toBe("MAP_OBJ");
      expect(ir.args[0].fn).toBe("MAP_PAIR");
      expect(ir.args[0].args[0]).toBe("identifier");
      expect(ir.args[0].args[1]).toBe("a");
    });

    test("{= (k)=1 } lowers expression key to MAP_PAIR(expression,...)", () => {
      const ir = L("{= (k)=1 };");
      expect(ir.fn).toBe("MAP_OBJ");
      expect(ir.args[0].fn).toBe("MAP_PAIR");
      expect(ir.args[0].args[0]).toBe("expression");
      expect(ir.args[0].args[1].fn).toBe("RETRIEVE");
      expect(ir.args[0].args[1].args).toEqual(["k"]);
    });

    test("{= 1=2 } is rejected (expression keys must be parenthesized)", () => {
      expect(() => L("{= 1=2 };")).toThrow("Map key expressions must be parenthesized");
    });
  });

  describe("Control Flow", () => {
    test("{; a; b; c } → BLOCK", () => {
      const ir = L("{; a := 1; b := 2; a + b };");
      expect(ir.fn).toBe("BLOCK");
      expect(ir.args.length).toBe(3);
      expect(ir.args[0].fn).toBe("ASSIGN_COPY");
    });

    test("{? cond1; cond2 } → CASE with DEFERs", () => {
      const ir = L("{? x > 0; x < 10 };");
      expect(ir.fn).toBe("CASE");
      expect(ir.args[0].fn).toBe("DEFER");
      expect(ir.args[1].fn).toBe("DEFER");
    });

    test("{@ init; cond } → LOOP with DEFERs", () => {
      const ir = L("{@ i := 0; i + 1 };");
      expect(ir.fn).toBe("LOOP");
      expect(ir.args[0].fn).toBe("DEFER");
    });

    test("{@loop:7@ ... } → LOOP with metadata", () => {
      const ir = L("{@loop:7@ i := 0; i < 1; i; i += 1 };");
      expect(ir.fn).toBe("LOOP");
      expect(ir.args[0]).toEqual({ name: "loop", maxIterations: 7 });
      expect(ir.args[1].fn).toBe("DEFER");
    });

    test("{@::@ ... } → LOOP with unlimited metadata", () => {
      const ir = L("{@::@ i := 0; i < 1; i; i += 1 };");
      expect(ir.fn).toBe("LOOP");
      expect(ir.args[0]).toEqual({ unlimited: true });
    });

    test("{?choose? ... } → CASE with name metadata", () => {
      const ir = L("{?choose? x > 0 ? 1; 2 };");
      expect(ir.fn).toBe("CASE");
      expect(ir.args[0]).toEqual({ name: "choose" });
      expect(ir.args[1].fn).toBe("DEFER");
    });

    test("{? cond ? action; fallback } lowers condition branches to CONDITION", () => {
      const ir = L("{? x > 0 ? 1; 2 };");
      expect(ir.fn).toBe("CASE");
      expect(ir.args[0].fn).toBe("DEFER");
      expect(ir.args[0].args[0].fn).toBe("CONDITION");
    });

    test("{!@outer! 5 } → BREAK", () => {
      const ir = L("{!@outer! 5 };");
      expect(ir).toEqual({
        fn: "BREAK",
        args: [
          { targetType: "loop", targetName: "outer" },
          { fn: "LITERAL", args: ["5"] },
        ],
      });
    });

    test("ternary a ?? b ?: c → TERNARY with DEFERs", () => {
      const ir = L("x > 0 ?? 1 ?: -1;");
      expect(ir.fn).toBe("TERNARY");
      expect(ir.args[0].fn).toBe("GT"); // condition
      expect(ir.args[1].fn).toBe("DEFER"); // true branch
      expect(ir.args[2].fn).toBe("DEFER"); // false branch
    });
  });

  describe("Deferred Blocks", () => {
    test("@{; x + 1 } → DEFER", () => {
      const ir = L("@{; x + 1 };");
      expect(ir.fn).toBe("DEFER");
      expect(ir.args[0].fn).toBe("BLOCK");
    });

    test("@{ a, b } → DEFER", () => {
      const ir = L("@{ a, b };");
      expect(ir.fn).toBe("DEFER");
    });
  });

  describe("Property Access", () => {
    test("obj.a → META_GET", () => {
      const ir = L("obj.a;");
      expect(ir.fn).toBe("META_GET");
      expect(ir.args[0]).toEqual({ fn: "RETRIEVE", args: ["obj"] });
      expect(ir.args[1]).toBe("a");
    });

    test("arr[i] → INDEX_GET", () => {
      const ir = L("arr[i];");
      expect(ir.fn).toBe("INDEX_GET");
    });

    test("obj[:foo] → INDEX_GET with string key", () => {
      const ir = L("obj[:foo];");
      expect(ir.fn).toBe("INDEX_GET");
      expect(ir.args[1]).toBe("foo");
    });

    test("obj[:1] → INDEX_GET with numeric key literal normalized to string", () => {
      const ir = L("obj[:1];");
      expect(ir.fn).toBe("INDEX_GET");
      expect(ir.args[1]).toBe("1");
    });

    test("obj.. → META_ALL", () => {
      const ir = L("obj..;");
      expect(ir.fn).toBe("META_ALL");
    });

    test("obj .= map → META_MERGE", () => {
      const ir = L("obj .= updates;");
      expect(ir.fn).toBe("META_MERGE");
      expect(ir.args[0]).toEqual({ fn: "RETRIEVE", args: ["obj"] });
      expect(ir.args[1]).toEqual({ fn: "RETRIEVE", args: ["updates"] });
    });

    test("obj..name is a parse error", () => {
      expect(() => L("obj..b;")).toThrow();
    });

    test("obj.| → KEYS", () => {
      const ir = L("obj.|;");
      expect(ir.fn).toBe("KEYS");
    });

    test("obj|. → VALUES", () => {
      const ir = L("obj|.;");
      expect(ir.fn).toBe("VALUES");
    });
  });

  describe("Mutation", () => {
    test("obj{= +a=3 } → MUTCOPY", () => {
      const ir = L("obj{= +a=3 };");
      expect(ir.fn).toBe("MUTCOPY");
      expect(ir.args[0]).toEqual({ fn: "RETRIEVE", args: ["obj"] });
      expect(ir.args[1][0].action).toBe("add");
      expect(ir.args[1][0].key).toBe("a");
    });

    test("obj{! +a=3 } → MUTINPLACE", () => {
      const ir = L("obj{! +a=3 };");
      expect(ir.fn).toBe("MUTINPLACE");
    });
  });

  describe("Pipes", () => {
    test("x |> F → PIPE", () => {
      const ir = L("x |> F;");
      expect(ir.fn).toBe("PIPE");
    });

    test("[1,2,3] |>> f → PMAP", () => {
      const ir = L("[1, 2, 3] |>> f;");
      expect(ir.fn).toBe("PMAP");
    });

    test("|>? → PFILTER", () => {
      const ir = L("[1, 2, 3] |>? f;");
      expect(ir.fn).toBe("PFILTER");
    });

    test("|>: → PREDUCE", () => {
      const ir = L("[1, 2, 3] |>: f;");
      expect(ir.fn).toBe("PREDUCE");
    });
  });

  describe("System Functions (@_)", () => {
    test("@_ASSIGN ref → SYSREF", () => {
      const ir = L("@_ASSIGN;");
      expect(ir.fn).toBe("SYSREF");
      expect(ir.args[0]).toBe("ASSIGN");
    });

    test("nested: @_ASSIGN(i, @_ADD(i, 1))", () => {
      const ir = L("@_ASSIGN(i, @_ADD(i, 1));");
      expect(ir.fn).toBe("SYS_CALL");
      expect(ir.args[0]).toBe("ASSIGN");
      expect(ir.args[1]).toEqual({ fn: "RETRIEVE", args: ["i"] });
      expect(ir.args[2].fn).toBe("SYS_CALL");
      expect(ir.args[2].args[0]).toBe("ADD");
    });
  });

  describe("Solve / Assertions", () => {
    test(":=: → SOLVE", () => {
      const ir = L("x :=: 5;");
      expect(ir.fn).toBe("SOLVE");
    });

    test(":<: → ASSERT_LT", () => {
      const ir = L("x :<: 5;");
      expect(ir.fn).toBe("ASSERT_LT");
    });

    test(":>: → ASSERT_GT", () => {
      const ir = L("x :>: 5;");
      expect(ir.fn).toBe("ASSERT_GT");
    });
  });

  describe("Code Blocks", () => {
    test("{; a; b } → BLOCK", () => {
      const ir = L("{; a; b };");
      expect(ir.fn).toBe("BLOCK");
      expect(ir.args.length).toBe(2);
    });

    test("block import header lowers to BLOCK metadata", () => {
      const ir = L("{; <a~x, b=y> a; b };");
      expect(ir.fn).toBe("BLOCK");
      expect(ir.args[0]).toEqual({
        imports: [
          { local: "a", source: "x", mode: "copy" },
          { local: "b", source: "y", mode: "alias" },
        ],
      });
      expect(ir.args[1].fn).toBe("RETRIEVE");
      expect(ir.args[2].fn).toBe("RETRIEVE");
    });
  });

  describe("Integration: complex expressions", () => {
    test("x = SIN(PI) + 2 * y", () => {
      const ir = L("x = SIN(PI) + 2 * y;");
      expect(ir.fn).toBe("ASSIGN");
      expect(ir.args[0]).toBe("x");
      expect(ir.args[1].fn).toBe("ADD");
      expect(ir.args[1].args[0].fn).toBe("CALL");
      expect(ir.args[1].args[0].args[0]).toBe("SIN");
      expect(ir.args[1].args[1].fn).toBe("MUL");
    });

    test("f(x) :-> {; a = x^2; a + 1 }", () => {
      const ir = L("f(x) :-> {; a = x^2; a + 1 };");
      expect(ir.fn).toBe("FUNCDEF");
      expect(ir.args[0]).toBe("f");
      expect(ir.args[2].fn).toBe("BLOCK");
      expect(ir.args[2].args[0].fn).toBe("ASSIGN");
      expect(ir.args[2].args[1].fn).toBe("ADD");
    });

    test("result = x > 0 ?? SIN(x) ?: COS(x)", () => {
      const ir = L("result = x > 0 ?? SIN(x) ?: COS(x);");
      expect(ir.fn).toBe("ASSIGN");
      expect(ir.args[0]).toBe("result");
      expect(ir.args[1].fn).toBe("TERNARY");
    });
  });
});
