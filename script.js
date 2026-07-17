/* ============================================================
   Sci-Calculator — script.js
   Author : Mohit
   ============================================================ */


/*---------------------------------------------------------------------------------*/


/* ============================================================
   GLASSCALC — LOGIC
   A dependency-free scientific calculator. No `eval()` is used;
   expressions are tokenized and evaluated by a small recursive-
   descent parser (see section 6) so operator precedence,
   parentheses and functions are all handled correctly and safely.

   File map:
   1. DOM references & constant lookup tables
   2. Mutable state
   3. Display rendering
   4. Text-input helpers (digits, operators, parens, functions...)
   5. Immediate unary transforms (%, x², x⁻¹, x!, x⁻²)
   6. Expression tokenizer + recursive-descent parser
   7. Top-level calculate() / history
   8. Angle-mode + button wiring
   9. Keyboard support
   ============================================================ */

/* ------------------------------------------------------------
   1. DOM REFERENCES & LOOKUP TABLES
   ------------------------------------------------------------ */

// Cache every element we touch more than once.
const displayEl = document.getElementById("display");
const expressionEl = document.getElementById("expression");
const displayWrap = document.querySelector(".display-wrap");
const historyToggle = document.getElementById("history-toggle");
const historyPanel = document.getElementById("history-panel");
const historyList = document.getElementById("history-list");
const historyEmpty = document.getElementById("history-empty");
const keypad = document.querySelector(".keypad");

// The four binary arithmetic operators, plus power ("^").
const OPERATORS = ["+", "-", "*", "/", "^"];

// Raw operator character -> the prettier glyph shown on screen.
const OP_SYMBOL = { "+": "+", "-": "−", "*": "×", "/": "÷", "^": "^" };

// Function name (as stored in the raw expression string) -> the
// nicer glyph shown in the on-screen expression line, e.g. the
// stored text "sqrt(" is rendered to the user as "√(".
const FUNC_DISPLAY = {
  sqrt: "√(",
  cbrt: "∛(",
  ln: "ln(",
  log: "log(",
  exp: "e^(",
  exp10: "10^(",
  abs: "abs(",
  sin: "sin(",
  cos: "cos(",
  tan: "tan(",
  asin: "sin⁻¹(",
  acos: "cos⁻¹(",
  atan: "tan⁻¹(",
};

// Longest names first, so e.g. "asin" is matched before "sin"
// while scanning the expression character by character.
const FUNC_NAMES = Object.keys(FUNC_DISPLAY).sort((a, b) => b.length - a.length);

// Function name -> actual math implementation. sin/cos/tan and
// their inverses respect the current angle mode via toRad/fromRad.
const FUNCS = {
  sin: (x) => Math.sin(toRad(x)),
  cos: (x) => Math.cos(toRad(x)),
  tan: (x) => Math.tan(toRad(x)),
  asin: (x) => fromRad(Math.asin(x)),
  acos: (x) => fromRad(Math.acos(x)),
  atan: (x) => fromRad(Math.atan(x)),
  ln: (x) => Math.log(x),
  log: (x) => Math.log10(x),
  exp: (x) => Math.exp(x),
  exp10: (x) => Math.pow(10, x),
  sqrt: (x) => Math.sqrt(x),
  cbrt: (x) => Math.cbrt(x),
  abs: (x) => Math.abs(x),
};

/* ------------------------------------------------------------
   2. MUTABLE STATE
   ------------------------------------------------------------ */

let current = "";           // the raw expression string being built
let justEvaluated = false;  // true right after "=" was pressed
let history = [];           // { expr, result } entries, newest first
let angleMode = "RAD";      // "RAD" | "DEG" | "GRAD"
let lastAnswer = 0;         // value inserted by the "Ans" key

/* ------------------------------------------------------------
   3. DISPLAY RENDERING
   ------------------------------------------------------------ */

/**
 * render()
 * Pushes the current expression string into the on-screen
 * <input>, substituting a plain "0" when nothing has been typed.
 */
function render() {
  const shown = current === "" ? "0" : current;
  displayEl.value = prettify(shown);
}

/**
 * prettify(str)
 * Converts the raw expression string (the form the parser
 * understands, e.g. "sin(30)+2^3") into the friendlier glyphs
 * shown to the user (e.g. "sin(30)+2^3" -> "sin(30)+2^3" with
 * × ÷ − substituted for * / -). Purely cosmetic; never touches
 * the underlying `current` state.
 */
function prettify(str) {
  let out = str;
  FUNC_NAMES.forEach((key) => {
    out = out.split(key + "(").join(FUNC_DISPLAY[key]);
  });
  out = out.replace(/[+\-*/^]/g, (m) => OP_SYMBOL[m] || m);
  return out;
}

/**
 * flashError()
 * Restarts the CSS "shake" animation on the display so pressing
 * an invalid key sequence (or hitting "=" on a bad expression)
 * gives clear visual feedback.
 */
function flashError() {
  displayWrap.classList.remove("error");
  void displayWrap.offsetWidth; // force reflow so the animation can replay
  displayWrap.classList.add("error");
}

/* ------------------------------------------------------------
   4. TEXT-INPUT HELPERS
   Each of these mutates `current` in response to one key press.
   ------------------------------------------------------------ */

/**
 * numericTail()
 * Returns the run of digits/decimal-point at the very end of
 * `current` — i.e. the number currently being typed. Used by the
 * unary transforms (%, x², 1/x, x!) to know what to operate on.
 */
function numericTail() {
  const m = current.match(/[0-9.]*$/);
  return m ? m[0] : "";
}

/**
 * appendDigit(d)
 * Types a single digit "0"-"9" onto the end of the expression.
 * Collapses a redundant leading "0" (so "0" then "5" becomes "5",
 * not "05") and starts a fresh expression if the previous action
 * was pressing "=".
 */
function appendDigit(d) {
  if (justEvaluated) {
    current = "";
    justEvaluated = false;
  }
  const tail = numericTail();
  if (tail === "0" && d === "0") return;
  if (tail === "0" && d !== "0") {
    current = current.slice(0, -1) + d;
  } else {
    current += d;
  }
  render();
}

/**
 * appendDecimal()
 * Types a "." — refuses to add a second decimal point to the
 * number currently being typed, and auto-prefixes a "0." if the
 * decimal point is the very first character of a new number.
 */
function appendDecimal() {
  if (justEvaluated) {
    current = "0";
    justEvaluated = false;
  }
  const tail = numericTail();
  if (tail.includes(".")) return;
  current += tail === "" ? "0." : ".";
  render();
}

/**
 * appendOperator(op)
 * Types one of + − × ÷ ^. If the expression is empty, only a
 * leading "-" is allowed (for negative numbers). If the last
 * character is already an operator (or a trailing "."), it is
 * replaced rather than stacked, so "5+*" collapses to "5*".
 */
function appendOperator(op) {
  justEvaluated = false;
  if (current === "") {
    if (op === "-") current = "-";
    render();
    return;
  }
  const last = current.slice(-1);
  if (OPERATORS.includes(last) || last === ".") {
    current = current.slice(0, -1) + op;
  } else {
    current += op;
  }
  render();
}

/**
 * appendParen(p)
 * Types "(" or ")". Starting a fresh expression with "(" resets
 * `current` if the previous action was "=".
 */
function appendParen(p) {
  if (justEvaluated) {
    current = p === "(" ? "" : current;
    justEvaluated = false;
  }
  current += p;
  render();
}

/**
 * appendConstant(name)
 * Inserts the symbol for π or e. Stored as the literal character
 * so the tokenizer can recognise it directly (see tokenize()).
 */
function appendConstant(name) {
  if (justEvaluated) {
    current = "";
    justEvaluated = false;
  }
  current += name === "pi" ? "π" : "e";
  render();
}

/**
 * appendFunction(name)
 * Inserts a function call opener, e.g. pressing "sin" types
 * "sin(" and leaves the cursor ready for an argument.
 */
function appendFunction(name) {
  if (justEvaluated) {
    current = "";
    justEvaluated = false;
  }
  current += name + "(";
  render();
}

/**
 * appendAns()
 * Inserts the numeric value produced by the most recent "="
 * press (or 0 if nothing has been calculated yet).
 */
function appendAns() {
  if (justEvaluated) {
    current = "";
    justEvaluated = false;
  }
  current += trimNumber(lastAnswer);
  render();
}

/**
 * negateLast()
 * Toggles the sign of the number currently being typed (the
 * "+/−" key). Detects whether a leading "-" already on that
 * number is a unary sign (vs. a binary subtraction) before
 * deciding to add or remove it.
 */
function negateLast() {
  const tail = numericTail();
  if (tail === "") return;
  const start = current.length - tail.length;
  const prevChar = current[start - 1];
  const prevIsUnaryMinus =
    prevChar === "-" && (start - 1 === 0 || "+-*/^(".includes(current[start - 2]));
  if (prevIsUnaryMinus) {
    current = current.slice(0, start - 1) + current.slice(start);
  } else {
    current = current.slice(0, start) + "-" + current.slice(start);
  }
  render();
}

/* ------------------------------------------------------------
   5. IMMEDIATE UNARY TRANSFORMS
   %, x², x⁻¹, x⁻², and x! all act *immediately* on the trailing
   number rather than being written into the expression, mirroring
   how simple pocket calculators behave.
   ------------------------------------------------------------ */

/**
 * transformTail(fn)
 * Shared helper: reads the trailing number, runs it through `fn`,
 * and splices the result back into `current`. Any thrown error or
 * non-finite result triggers the error flash instead of corrupting
 * the display.
 */
function transformTail(fn) {
  const tail = numericTail();
  if (tail === "" || tail === ".") return;
  const value = parseFloat(tail);
  let result;
  try {
    result = fn(value);
  } catch (e) {
    flashError();
    return;
  }
  if (typeof result !== "number" || !isFinite(result)) {
    flashError();
    return;
  }
  const start = current.length - tail.length;
  current = current.slice(0, start) + trimNumber(result);
  justEvaluated = false;
  render();
}

/** applyPercent() — divides the trailing number by 100. */
function applyPercent() {
  transformTail((v) => v / 100);
}

/** applySquare() — raises the trailing number to the 2nd power (x²). */
function applySquare() {
  transformTail((v) => Math.pow(v, 2));
}

/** applyInverseSquare() — computes 1 / x² for the trailing number (x⁻²). */
function applyInverseSquare() {
  transformTail((v) => {
    if (v === 0) throw new Error("div0");
    return 1 / (v * v);
  });
}

/** applyReciprocal() — computes 1 / x for the trailing number (x⁻¹). */
function applyReciprocal() {
  transformTail((v) => {
    if (v === 0) throw new Error("div0");
    return 1 / v;
  });
}

/**
 * applyFactorial()
 * Computes x! for the trailing number. Only defined for
 * non-negative integers up to 170 (beyond that, double-precision
 * floats overflow to Infinity).
 */
function applyFactorial() {
  transformTail((v) => {
    if (v < 0 || !Number.isInteger(v) || v > 170) throw new Error("bad");
    let r = 1;
    for (let i = 2; i <= v; i++) r *= i;
    return r;
  });
}

/**
 * trimNumber(n)
 * Formats a raw JS number for display/storage: rounds away
 * floating-point noise (e.g. 0.1+0.2) to 12 significant digits
 * and returns "Error" for non-finite values.
 */
function trimNumber(n) {
  if (!isFinite(n)) return "Error";
  return parseFloat(n.toPrecision(12)).toString();
}

/**
 * clearAll()
 * The "C" key: wipes the expression, clears any error state, and
 * blanks the small expression line above the main display.
 */
function clearAll() {
  current = "";
  justEvaluated = false;
  displayWrap.classList.remove("error");
  expressionEl.innerHTML = "&nbsp;";
  render();
}

/**
 * deleteLast()
 * The "⌫" key: removes the last character. If the display is
 * currently showing a just-computed result, "⌫" clears it instead
 * of deleting one digit at a time from the answer.
 */
function deleteLast() {
  if (justEvaluated) {
    clearAll();
    return;
  }
  current = current.slice(0, -1);
  render();
}

/* ------------------------------------------------------------
   6. EXPRESSION TOKENIZER + RECURSIVE-DESCENT PARSER
   Grammar (lowest to highest precedence):
     expr   := term (('+'|'-') term)*
     term   := power (('*'|'/') power)*
     power  := unary ('^' power)?              (right-associative)
     unary  := ('-'|'+') unary | primary
     primary:= NUMBER | '(' expr ')' | FUNC '(' expr ')'
   Implicit multiplication (e.g. "2π", "3(4+1)", ")(") is inserted
   as an extra pass over the token stream before parsing.
   ------------------------------------------------------------ */

/**
 * toRad(x)
 * Converts a value from the current angle unit into radians, for
 * use by Math.sin/cos/tan. Supports RAD (no-op), DEG (÷180×π) and
 * GRAD (÷200×π — a full turn is 400 gradians).
 */
function toRad(x) {
  if (angleMode === "DEG") return (x * Math.PI) / 180;
  if (angleMode === "GRAD") return (x * Math.PI) / 200;
  return x;
}

/**
 * fromRad(x)
 * The inverse of toRad(): converts a radian value (as returned by
 * Math.asin/acos/atan) back into the current angle unit.
 */
function fromRad(x) {
  if (angleMode === "DEG") return (x * 180) / Math.PI;
  if (angleMode === "GRAD") return (x * 200) / Math.PI;
  return x;
}

/**
 * tokenize(expr)
 * Scans the raw expression string into a flat token list — numbers,
 * operators, parentheses and function names — then makes a second
 * pass to insert implicit multiplication tokens between adjacent
 * values (e.g. "2π" -> [2, *, π], "3(4+1)" -> [3, *, (, 4, +, 1, )]).
 */
function tokenize(expr) {
  const raw = [];
  let i = 0;
  while (i < expr.length) {
    const ch = expr[i];
    if (/[0-9.]/.test(ch)) {
      let num = ch;
      i++;
      while (i < expr.length && /[0-9.]/.test(expr[i])) {
        num += expr[i];
        i++;
      }
      raw.push({ type: "num", value: parseFloat(num) });
      continue;
    }
    if (ch === "π") {
      raw.push({ type: "num", value: Math.PI });
      i++;
      continue;
    }
    if (ch === "(") {
      raw.push({ type: "lparen" });
      i++;
      continue;
    }
    if (ch === ")") {
      raw.push({ type: "rparen" });
      i++;
      continue;
    }
    if (OPERATORS.includes(ch)) {
      raw.push({ type: "op", value: ch });
      i++;
      continue;
    }
    // Letters: try the longest function name first (e.g. "exp10" must
    // win over "exp"), and ONLY fall back to the constant "e" if no
    // function name matched — otherwise "exp10(" would be misread as
    // the constant e followed by the digits "10".
    if (/[a-zA-Z]/.test(ch)) {
      let matchedFunc = false;
      for (const name of FUNC_NAMES) {
        if (expr.startsWith(name, i)) {
          raw.push({ type: "func", value: name });
          i += name.length;
          matchedFunc = true;
          break;
        }
      }
      if (matchedFunc) continue;
      if (ch === "e") {
        raw.push({ type: "num", value: Math.E });
        i++;
        continue;
      }
      i++; // unrecognised letter — skip it defensively
      continue;
    }
    i++; // unrecognised character — skip it defensively
  }

  // Second pass: insert "*" between a value-ending token and a
  // value-starting token that have nothing explicit between them.
  const tokens = [];
  for (let j = 0; j < raw.length; j++) {
    const t = raw[j];
    if (j > 0) {
      const prev = raw[j - 1];
      const prevEndsValue = prev.type === "num" || prev.type === "rparen";
      const curStartsValue = t.type === "num" || t.type === "lparen" || t.type === "func";
      if (prevEndsValue && curStartsValue) {
        tokens.push({ type: "op", value: "*" });
      }
    }
    tokens.push(t);
  }
  return tokens;
}

/**
 * parseExpression(tokens)
 * Recursive-descent parser/evaluator: walks the token list once
 * and returns the final numeric result, respecting standard
 * precedence (^ before × ÷ before + −) and parentheses/functions.
 * Throws a plain Error (caught by evaluateExpression) on div-by-
 * zero, domain errors (sqrt of a negative number, etc.), or a
 * malformed expression.
 */
function parseExpression(tokens) {
  let pos = 0;
  const peek = () => tokens[pos];
  const next = () => tokens[pos++];

  // expr := term (('+'|'-') term)*
  function parseExpr() {
    let node = parseTerm();
    while (peek() && peek().type === "op" && (peek().value === "+" || peek().value === "-")) {
      const op = next().value;
      const right = parseTerm();
      node = op === "+" ? node + right : node - right;
    }
    return node;
  }

  // term := power (('*'|'/') power)*
  function parseTerm() {
    let node = parsePower();
    while (peek() && peek().type === "op" && (peek().value === "*" || peek().value === "/")) {
      const op = next().value;
      const right = parsePower();
      if (op === "/" && right === 0) throw new Error("div0");
      node = op === "*" ? node * right : node / right;
    }
    return node;
  }

  // power := unary ('^' power)?   — right-associative, so 2^3^2 = 2^(3^2)
  function parsePower() {
    const base = parseUnary();
    if (peek() && peek().type === "op" && peek().value === "^") {
      next();
      const exponent = parsePower();
      return Math.pow(base, exponent);
    }
    return base;
  }

  // unary := ('-'|'+') unary | primary
  function parseUnary() {
    if (peek() && peek().type === "op" && (peek().value === "-" || peek().value === "+")) {
      const op = next().value;
      const val = parseUnary();
      return op === "-" ? -val : val;
    }
    return parsePrimary();
  }

  // primary := NUMBER | '(' expr ')' | FUNC '(' expr ')'
  function parsePrimary() {
    const t = peek();
    if (!t) throw new Error("incomplete");
    if (t.type === "num") {
      next();
      return t.value;
    }
    if (t.type === "lparen") {
      next();
      const val = parseExpr();
      if (!peek() || peek().type !== "rparen") throw new Error("paren");
      next();
      return val;
    }
    if (t.type === "func") {
      next();
      if (!peek() || peek().type !== "lparen") throw new Error("func");
      next();
      const arg = parseExpr();
      if (!peek() || peek().type !== "rparen") throw new Error("paren");
      next();
      const result = FUNCS[t.value](arg);
      if (typeof result !== "number" || Number.isNaN(result)) throw new Error("domain");
      return result;
    }
    throw new Error("unexpected");
  }

  const result = parseExpr();
  if (pos !== tokens.length) throw new Error("trailing");
  return result;
}

/**
 * evaluateExpression(expr)
 * Tokenizes and parses a full expression string, throwing on an
 * empty input or a non-finite (Infinity/NaN) final result.
 */
function evaluateExpression(expr) {
  const tokens = tokenize(expr);
  if (tokens.length === 0) throw new Error("empty");
  const result = parseExpression(tokens);
  if (!isFinite(result)) throw new Error("infinite");
  return result;
}

/**
 * balanceParens(expr)
 * Auto-appends any missing closing parentheses so "sin(30" is
 * treated as "sin(30)" when the user presses "=" without having
 * closed every bracket themselves.
 */
function balanceParens(expr) {
  let open = 0;
  for (const ch of expr) {
    if (ch === "(") open++;
    if (ch === ")") open--;
  }
  return open > 0 ? expr + ")".repeat(open) : expr;
}

/* ------------------------------------------------------------
   7. TOP-LEVEL CALCULATE() / HISTORY
   ------------------------------------------------------------ */

/**
 * calculate()
 * The "=" key. Trims a dangling trailing operator, auto-closes
 * parentheses, evaluates the expression, and either shows the
 * result (recording it to history + Ans) or shows "Error" with a
 * visual flash if evaluation failed.
 */
function calculate() {
  if (current === "" || current === "-") return;
  let exprToEval = current;
  if (OPERATORS.includes(exprToEval.slice(-1))) {
    exprToEval = exprToEval.slice(0, -1);
  }
  exprToEval = balanceParens(exprToEval);
  try {
    const result = evaluateExpression(exprToEval);
    const resultStr = trimNumber(result);
    expressionEl.textContent = prettify(exprToEval) + " =";
    addHistory(prettify(exprToEval), resultStr);
    lastAnswer = result;
    current = resultStr;
    justEvaluated = true;
    render();
  } catch (err) {
    displayEl.value = "Error";
    flashError();
    current = "";
    justEvaluated = true;
  }
}

/**
 * addHistory(expr, result)
 * Pushes a new entry to the front of the history list (capped at
 * 20 entries) and re-renders the history panel.
 */
function addHistory(expr, result) {
  history.unshift({ expr, result });
  history = history.slice(0, 20);
  renderHistory();
}

/**
 * renderHistory()
 * Redraws the history panel's <ul> from the `history` array, or
 * shows the "No calculations yet" placeholder when it's empty.
 */
function renderHistory() {
  if (history.length === 0) {
    historyEmpty.style.display = "block";
    historyList.innerHTML = "";
    return;
  }
  historyEmpty.style.display = "none";
  historyList.innerHTML = history
    .map(
      (h) =>
        `<li data-result="${h.result}"><span>${h.expr}</span> = <span class="h-result">${h.result}</span></li>`
    )
    .join("");
}

// Clicking a past entry reloads its result into the display.
historyList.addEventListener("click", (e) => {
  const li = e.target.closest("li");
  if (!li) return;
  current = li.dataset.result;
  justEvaluated = true;
  render();
});

// The "···" button opens/closes the history panel.
historyToggle.addEventListener("click", () => {
  historyPanel.classList.toggle("open");
});

/* ------------------------------------------------------------
   8. ANGLE-MODE + BUTTON WIRING
   ------------------------------------------------------------ */

/**
 * setAngleMode(mode)
 * Switches between RAD / DEG / GRAD, and updates which of the
 * three toggle buttons shows the "active" (orange) styling.
 */
function setAngleMode(mode) {
  angleMode = mode;
  document.querySelectorAll(".btn.angle").forEach((b) => {
    b.classList.toggle("active", b.dataset.angle === mode);
  });
}

/**
 * pressEffect(btn)
 * Briefly adds the "pressed" class to a button so its scale-down
 * + flash animation replays on every tap, including keyboard-
 * triggered presses.
 */
function pressEffect(btn) {
  btn.classList.remove("pressed");
  void btn.offsetWidth; // force reflow so the animation can restart
  btn.classList.add("pressed");
  setTimeout(() => btn.classList.remove("pressed"), 220);
}

/**
 * highlightActiveOperator()
 * Outlines whichever + − × ÷ button matches the operator currently
 * sitting at the end of the expression (e.g. right after typing
 * "12+"), so it's clear which operation is pending.
 */
function highlightActiveOperator() {
  document.querySelectorAll(".btn.op").forEach((b) => b.classList.remove("active-op"));
  const last = current.slice(-1);
  if (["+", "-", "*", "/"].includes(last)) {
    const btn = document.querySelector(`.btn.op[data-value="${CSS.escape(last)}"]`);
    if (btn) btn.classList.add("active-op");
  }
}

/**
 * handleAction(btn)
 * Central dispatcher: reads a pressed button's data-* attributes
 * and calls the matching input-handling function. This is the one
 * place that decides what every key on the keypad actually does.
 */
function handleAction(btn) {
  const action = btn.dataset.action;
  const value = btn.dataset.value;
  const type = btn.dataset.type;
  const func = btn.dataset.func;
  const constName = btn.dataset.const;
  const paren = btn.dataset.paren;
  const transform = btn.dataset.transform;
  const angle = btn.dataset.angle;

  if (action === "clear") clearAll();
  else if (action === "delete") deleteLast();
  else if (action === "equals") calculate();
  else if (action === "ans") appendAns();
  else if (action === "negate") negateLast();
  else if (action === "set-angle") setAngleMode(angle);
  else if (transform === "percent") applyPercent();
  else if (transform === "square") applySquare();
  else if (transform === "inverseSquare") applyInverseSquare();
  else if (transform === "reciprocal") applyReciprocal();
  else if (transform === "factorial") applyFactorial();
  else if (type === "operator") appendOperator(value);
  else if (value === ".") appendDecimal();
  else if (func) appendFunction(func);
  else if (constName) appendConstant(constName);
  else if (paren) appendParen(paren);
  else if (value !== undefined) appendDigit(value);

  highlightActiveOperator();
}

// Single delegated click listener covers every key on the keypad.
keypad.addEventListener("click", (e) => {
  const btn = e.target.closest(".btn");
  if (!btn) return;
  pressEffect(btn);
  handleAction(btn);
});

/* ------------------------------------------------------------
   9. KEYBOARD SUPPORT
   ------------------------------------------------------------ */

/**
 * (keydown listener)
 * Mirrors every on-screen key to a physical keyboard shortcut:
 * digits, + - * / ^, ( ), Enter/= for equals, Backspace, and Esc
 * to clear. Also flashes the matching on-screen button so keyboard
 * input feels connected to the UI.
 */
window.addEventListener("keydown", (e) => {
  const key = e.key;
  let btnSelector = null;

  if (/^[0-9]$/.test(key)) {
    appendDigit(key);
    btnSelector = `.btn.num[data-value="${key}"]`;
  } else if (key === ".") {
    appendDecimal();
    btnSelector = `.btn.num[data-value="."]`;
  } else if (["+", "-", "*", "/", "^"].includes(key)) {
    appendOperator(key);
    btnSelector = `.btn[data-value="${CSS.escape(key)}"][data-type="operator"]`;
  } else if (key === "(" || key === ")") {
    appendParen(key);
    btnSelector = `.btn[data-paren="${key}"]`;
  } else if (key === "%") {
    applyPercent();
    btnSelector = `.btn[data-transform="percent"]`;
  } else if (key === "Enter" || key === "=") {
    e.preventDefault();
    calculate();
    btnSelector = `.btn.equal`;
  } else if (key === "Backspace") {
    deleteLast();
    btnSelector = `.btn.util[data-action="delete"]`;
  } else if (key === "Escape") {
    clearAll();
    btnSelector = `.btn.util[data-action="clear"]`;
  } else {
    return;
  }

  highlightActiveOperator();
  if (btnSelector) {
    const btn = document.querySelector(btnSelector);
    if (btn) pressEffect(btn);
  }
});

/* ------------------------------------------------------------
   INIT
   ------------------------------------------------------------ */

// Start in RAD mode (matching the reference design) with a clean display.
setAngleMode("RAD");
clearAll();
