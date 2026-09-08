/**
 * Build gate: complete bundle policy over the generated release output (GATES.md §2,
 * Architecture §18 gate 9, Requirements 2.1-2.3 and 7.5, AGENTS.md Kindle capability rule).
 *
 * One invocation inventories every executable JavaScript output in `dist/` — external `.js`
 * files and executable inline scripts inside emitted HTML — and enforces three policies on
 * the parsed ASTs:
 *
 * 1. ES2019: every unit parses under an ES2019-compatible mode (classic or module, matching
 *    how the artifact is loaded). Optional chaining, nullish coalescing, and any other
 *    post-ES2019 syntax return nonzero.
 * 2. Exact authorization scope: every Google auth-scope literal in any executable output must
 *    be exactly the Drive app-data scope; no broader or additional scope may appear, in any
 *    order.
 * 3. No window opening: no call whose statically evident function value comes from the global
 *    `open` capability — direct dot/bracket access on any equivalent global object (window,
 *    self, globalThis, top, parent, document.defaultView), a bare `open(...)` call that resolves
 *    to the global environment in its lexical scope, identifier aliases of that function value
 *    (including chains), transparent sequence-expression wrappers, and direct static
 *    `call`/`apply`/`Reflect.apply` invocations of the global value. Resolution is
 *    lexical-scope-aware: a local declaration or parameter named `open` or `window` only
 *    shadows references inside its own scope, and an alias gains provenance only where its
 *    assigned value resolves to the global capability at the assignment site.
 *
 * The executable inventory follows HTML execution semantics: an external script reference is
 * executable in its declared mode regardless of filename suffix (`.js`, `.mjs`, extensionless),
 * and a query or fragment does not change the referenced local file. Non-JavaScript data scripts
 * are not executable units. Unreferenced JavaScript outputs using the repository `.js` output
 * convention remain inventoried as well.
 *
 * The analysis is limited to ordinary, stable generated code: it does not prove absence of
 * popups against runtime mutation, `eval`, or hostile reflective construction.
 */
import { parse } from 'acorn';
import { readdir, readFile, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const APP_DATA_SCOPE = 'https://www.googleapis.com/auth/drive.appdata';
const SCOPE_PREFIX = 'https://www.googleapis.com/auth/';
/** Identifiers that name the page's global object (or an equivalent window reference). */
const WINDOW_GLOBALS = new Set(['window', 'self', 'globalThis', 'top', 'parent']);

/** The structural subset of one parsed AST used by this gate. */
interface AstNode {
  type: string;
  name?: string;
  value?: unknown;
  computed?: boolean;
  operator?: string;
  param?: AstNode;
  object?: AstNode | null;
  property?: AstNode | null;
  callee?: AstNode | null;
  id?: AstNode | null;
  init?: AstNode | null;
  left?: AstNode | null;
  right?: AstNode | null;
  quasis?: Array<{ value: { cooked: string | null } }>;
  expressions?: Array<AstNode>;
  arguments?: Array<AstNode>;
  params?: Array<AstNode>;
  kind?: string;
  declarations?: Array<{ id?: AstNode | null; init?: AstNode | null }>;
  start?: number;
  end?: number;
}

interface ExecutableUnit {
  /** Stable, human-readable location used in diagnostics. */
  label: string;
  source: string;
  /** Loading mode declared by the referencing tag; `auto` for unreferenced external files. */
  mode: 'script' | 'module' | 'auto';
}

function isAstNode(value: unknown): value is AstNode {
  return value !== null && typeof value === 'object' && typeof (value as AstNode).type === 'string';
}

/** Visit every node of one AST. */
function walkAst(root: AstNode, visit: (node: AstNode) => void): void {
  const queue: AstNode[] = [root];
  while (queue.length > 0) {
    const current = queue.pop() as AstNode;
    visit(current);
    for (const key of Object.keys(current)) {
      if (key === 'sourceFile' || key === 'range' || key === 'loc') continue;
      const value = (current as unknown as Record<string, unknown>)[key];
      if (Array.isArray(value)) {
        for (const item of value) if (isAstNode(item)) queue.push(item);
      } else if (isAstNode(value)) {
        queue.push(value);
      }
    }
  }
}

/** Recursively list every file under a directory, deterministic (sorted) order. */
async function listFiles(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const entry of (await readdir(dir, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await listFiles(path)));
    else if (entry.isFile()) out.push(path);
  }
  return out;
}

/** Extract every <script> tag from one emitted HTML document. */
function extractScriptTags(html: string): Array<{ attrs: string; inline: string | null }> {
  const tags: Array<{ attrs: string; inline: string | null }> = [];
  const re = /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(html)) !== null) {
    const attrs = match[1] ?? '';
    tags.push(/\bsrc\s*=/i.test(attrs) ? { attrs, inline: null } : { attrs, inline: match[2] ?? '' });
  }
  return tags;
}

/**
 * The execution mode of one script tag. Returns `null` for non-JavaScript data scripts
 * (for example `application/json`), which are not executable units.
 */
function tagMode(attrs: string): 'script' | 'module' | null {
  const m = /\btype\s*=\s*["']?([^"'\s>]+)/i.exec(attrs);
  if (m === null) return 'script';
  const type = m[1]?.toLowerCase() ?? '';
  if (type === 'module') return 'module';
  if (
    type === '' ||
    type === 'text/javascript' ||
    type === 'application/javascript' ||
    type === 'text/ecmascript' ||
    type === 'application/ecmascript'
  ) {
    return 'script';
  }
  return null;
}

/** Inventory every executable unit in one dist directory. */
async function inventoryUnits(distDir: string): Promise<ExecutableUnit[]> {
  const inlineUnits: ExecutableUnit[] = [];
  const externalModes = new Map<string, Set<'script' | 'module'>>();
  const files = await listFiles(distDir);

  for (const file of files) {
    if (!file.endsWith('.html')) continue;
    const html = await readFile(file, 'utf8');
    let inlineIndex = 0;
    for (const tag of extractScriptTags(html)) {
      const label = `${file.slice(distDir.length + 1)}#script-${++inlineIndex}`;
      const mode = tagMode(tag.attrs);
      const srcMatch = /\bsrc\s*=\s*["']?([^"'\s>]+)/i.exec(tag.attrs);
      if (srcMatch !== null) {
        // External reference: the referenced file must exist in the emitted inventory.
        // A query or fragment does not change the identity of the local file, and a
        // filename suffix does not determine whether the browser executes it.
        const ref = (srcMatch[1] ?? '')
          .split(/[?#]/)[0]
          .replace(/^\.\//, '')
          .replace(/^\//, '');
        const refPath = join(distDir, ref);
        try {
          await stat(refPath);
        } catch (_error) {
          throw new Error(`${label} references a script that is missing from the build output: ${srcMatch[1]}`);
        }
        if (mode !== null) {
          const modes = externalModes.get(refPath) ?? new Set<'script' | 'module'>();
          modes.add(mode);
          externalModes.set(refPath, modes);
        }
      } else if (mode !== null) {
        // Executable inline script; data scripts are not executable units.
        inlineUnits.push({ label, source: tag.inline ?? '', mode });
      }
    }
  }

  // Executable external units: every path referenced by an executable script tag,
  // independent of its suffix, plus the repository `.js` output convention for
  // unreferenced JavaScript outputs.
  const externalPaths = new Set<string>([...externalModes.keys(), ...files.filter((f) => f.endsWith('.js'))]);
  const units: ExecutableUnit[] = [...inlineUnits];
  for (const file of [...externalPaths].sort()) {
    const modes = externalModes.get(file);
    const mode: ExecutableUnit['mode'] = modes === undefined || modes.size !== 1 ? 'auto' : [...modes][0];
    units.push({ label: file.slice(distDir.length + 1), source: await readFile(file, 'utf8'), mode });
  }

  return units.sort((a, b) => a.label.localeCompare(b.label));
}

function parseAt(source: string, ecmaVersion: 2019 | 2022, sourceType: 'script' | 'module'): AstNode {
  return parse(source, { ecmaVersion, sourceType, locations: true }) as unknown as AstNode;
}

/** Parse one unit under its ES2019-compatible mode; throws a stable diagnostic on failure. */
function parseUnit(unit: ExecutableUnit): AstNode {
  const candidates: Array<'script' | 'module'> =
    unit.mode === 'auto' ? ['script', 'module'] : [unit.mode];
  let firstError: Error | null = null;
  for (const sourceType of candidates) {
    try {
      return parseAt(unit.source, 2019, sourceType);
    } catch (error) {
      if (firstError === null) firstError = error as Error;
    }
  }
  // Distinguish "newer than ES2019" from "not valid JavaScript at all": a parse under a newer
  // engine grammar succeeding proves the unit only failed because of post-ES2019 syntax.
  for (const sourceType of candidates) {
    try {
      parseAt(unit.source, 2022, sourceType);
    } catch (_error) {
      continue;
    }
    throw new Error(
      `${unit.label} uses JavaScript newer than ES2019 (for example optional chaining or nullish coalescing): ${firstError?.message}`
    );
  }
  throw new Error(`${unit.label} is not valid JavaScript: ${firstError?.message}`);
}

/** The property name of one member expression, for both dot and quoted-bracket spellings. */
function propertyName(node: AstNode): string | null {
  const property = node.property;
  if (property === null || property === undefined) return null;
  if (node.computed === true) return typeof property.value === 'string' ? property.value : null;
  return property.type === 'Identifier' ? property.name ?? null : null;
}

/** Resolve a statically constant string expression, including concatenation of literals. */
function getStaticString(node: AstNode | null | undefined): string | null {
  if (node === null || node === undefined) return null;
  if (node.type === 'Literal' && typeof node.value === 'string') return node.value as string;
  if (node.type === 'TemplateLiteral') {
    if (node.expressions && node.expressions.length > 0) return null;
    const parts = (node.quasis ?? []).map((q) => q.value.cooked ?? '');
    return parts.join('');
  }
  if (node.type === 'BinaryExpression' && node.operator === '+') {
    const left = getStaticString(node.left);
    const right = getStaticString(node.right);
    if (left !== null && right !== null) return left + right;
    return null;
  }
  return null;
}

/** Collect every Google auth-scope literal (string or template quasi) in one AST. */
function collectScopeLiterals(ast: AstNode): string[] {
  const scopes: string[] = [];
  const idToInit = new Map<string, AstNode>();
  walkAst(ast, (node) => {
    if (node.type === 'VariableDeclarator' && node.id?.type === 'Identifier' && node.init) {
      idToInit.set(node.id.name ?? '', node.init);
    }
    if (node.type === 'AssignmentExpression' && node.left?.type === 'Identifier' && node.right) {
      idToInit.set(node.left.name ?? '', node.right);
    }
  });

  const resolveIdentifierChain = (name: string, seen = new Set<string>()): AstNode | null => {
    if (seen.has(name)) return null;
    seen.add(name);
    const init = idToInit.get(name);
    if (!init) return null;
    if (init.type === 'Identifier') {
      return resolveIdentifierChain(init.name ?? '', seen);
    }
    return init;
  };

  const resolveStaticString = (node: AstNode | null | undefined, seen = new Set<string>()): string | null => {
    if (!node) return null;
    if (node.type === 'Literal' && typeof node.value === 'string') return node.value as string;
    if (node.type === 'TemplateLiteral') {
      let result = '';
      const quasis = node.quasis ?? [];
      const exprs = node.expressions ?? [];
      for (let i = 0; i < quasis.length; i++) {
        result += quasis[i].value.cooked ?? '';
        if (i < exprs.length) {
          const exprVal = resolveStaticString(exprs[i], seen);
          if (exprVal === null) return null;
          result += exprVal;
        }
      }
      return result;
    }
    if (node.type === 'BinaryExpression' && node.operator === '+') {
      const left = resolveStaticString(node.left, seen);
      const right = resolveStaticString(node.right, seen);
      if (left === null || right === null) return null;
      return left + right;
    }
    if (node.type === 'Identifier') {
      const name = node.name ?? '';
      if (seen.has(name)) return null;
      const resolved = resolveIdentifierChain(name, seen);
      if (resolved) return resolveStaticString(resolved, seen);
      return null;
    }
    return null;
  };

  walkAst(ast, (node) => {
    const staticStr = resolveStaticString(node);
    if (staticStr !== null && staticStr.startsWith(SCOPE_PREFIX)) {
      scopes.push(staticStr);
    }
  });
  return scopes;
}

/** Collect scope values written via a .set('scope', value) sink. */
function collectScopeSinks(ast: AstNode): string[] {
  const values: string[] = [];
  const { scopes, bindings, nodeScopes, declaratorSites, assignmentSites } = buildScopes(ast);

  const resolveBinding = (name: string, scopeId: number): Binding | undefined => {
    for (let current = scopeId; current >= 0; current = scopes[current].parent) {
      const found = bindings[current].get(name);
      if (found !== undefined) return found;
    }
    return undefined;
  };

  const bindingValue = new Map<Binding, AstNode>();
  for (const site of declaratorSites) {
    if (!bindingValue.has(site.binding)) {
      bindingValue.set(site.binding, site.value);
    }
  }
  for (const site of assignmentSites) {
    const binding = resolveBinding(site.name, site.scopeId);
    if (binding && !bindingValue.has(binding)) {
      bindingValue.set(binding, site.value);
    }
  }

  const getLatestValueForBinding = (binding: Binding, sinkPos: number): AstNode | null => {
    let bestStart = -1;
    let bestValue: AstNode | null = null;
    for (const site of declaratorSites) {
      if (site.binding === binding) {
        const s = site.start ?? -1;
        if (s < sinkPos && s > bestStart) {
          bestStart = s;
          bestValue = site.value;
        }
      }
    }
    for (const site of assignmentSites) {
      const b = resolveBinding(site.name, site.scopeId);
      if (b === binding) {
        const s = site.start ?? -1;
        if (s < sinkPos && s > bestStart) {
          bestStart = s;
          bestValue = site.value;
        }
      }
    }
    // DEBUG
    // console.log('getLatest for binding', binding, 'sinkPos', sinkPos, 'bestStart', bestStart, 'value', bestValue?.type);
    return bestValue;
  };

  const isNewUrlSearchParams = (node: AstNode | null | undefined, scopeId: number): boolean => {
    if (!node || node.type !== 'NewExpression') return false;
    const callee = node.callee;
    if (!callee || callee.type !== 'Identifier') return false;
    const name = callee.name;
    if (name !== 'URLSearchParams') return false;
    // Verify constructor resolves to global, not shadowed
    const binding = resolveBinding(name, scopeId);
    return binding === undefined;
  };

  const isUrlSearchParamsExpr = (node: AstNode | null | undefined, scopeId: number, seen = new Set<Binding>()): boolean => {
    if (!node) return false;
    if (isNewUrlSearchParams(node, scopeId)) return true;
    if (node.type === 'Identifier') {
      const binding = resolveBinding(node.name ?? '', scopeId);
      if (!binding) return false;
      if (seen.has(binding)) return false;
      seen.add(binding);
      const val = bindingValue.get(binding);
      if (!val) return false;
      if (isNewUrlSearchParams(val, scopeId)) return true;
      if (val.type === 'Identifier') {
        // Resolve alias via same scope as the declaration site? Approximate by using current scope.
        return isUrlSearchParamsExpr(val, scopeId, seen);
      }
    }
    return false;
  };

  const resolveStaticString = (node: AstNode | null | undefined, scopeId: number, seen = new Set<string>(), sinkPos?: number): string | null => {
    if (!node) return null;
    if (node.type === 'Literal' && typeof node.value === 'string') return node.value as string;
    if (node.type === 'TemplateLiteral') {
      let result = '';
      const quasis = node.quasis ?? [];
      const exprs = node.expressions ?? [];
      for (let i = 0; i < quasis.length; i++) {
        result += quasis[i].value.cooked ?? '';
        if (i < exprs.length) {
          const ev = resolveStaticString(exprs[i], scopeId, seen, sinkPos);
          if (ev === null) return null;
          result += ev;
        }
      }
      return result;
    }
    if (node.type === 'BinaryExpression' && node.operator === '+') {
      const left = resolveStaticString(node.left, scopeId, seen, sinkPos);
      const right = resolveStaticString(node.right, scopeId, seen, sinkPos);
      if (left === null || right === null) return null;
      return left + right;
    }
    if (node.type === 'Identifier') {
      const name = node.name ?? '';
      if (seen.has(name)) return null;
      seen.add(name);
      const binding = resolveBinding(name, scopeId);
      if (!binding) return null;
      const pos = sinkPos ?? Number.MAX_SAFE_INTEGER;
      const val = getLatestValueForBinding(binding, pos);
      if (!val) return null;
      return resolveStaticString(val, scopeId, seen, pos);
    }
    return null;
  };

  walkAst(ast, (node) => {
    if (node.type !== 'CallExpression') return;
    const scopeId = nodeScopes.get(node) ?? 0;
    const sinkPos = node.start ?? Number.MAX_SAFE_INTEGER;
    const callee = unwrapCallee(node.callee);
    if (!callee || callee.type !== 'MemberExpression') return;
    const prop = propertyName(callee);
    if (prop !== 'set') return;

    const receiver = callee.object;
    if (!isUrlSearchParamsExpr(receiver, scopeId)) return;

    const firstArg = node.arguments?.[0];
    const firstStatic = resolveStaticString(firstArg, scopeId, new Set<string>(), sinkPos);
    if (firstStatic !== 'scope') return;

    const secondArg = node.arguments?.[1];
    const secondStatic = resolveStaticString(secondArg, scopeId, new Set<string>(), sinkPos);
    if (secondStatic !== null) {
      values.push(secondStatic);
    } else {
      values.push('__UNRESOLVED__');
    }
  });

  return values;
}

/** One lexical scope in a unit's scope tree (program, function, or block). */
interface ScopeInfo {
  /** Index of the enclosing scope, or -1 for the program scope. */
  parent: number;
}

/** A named binding created by a declaration or parameter, with its provenance flags. */
interface Binding {
  /** True when a value assigned to this binding is statically a global window object. */
  globalObj: boolean;
  /** True when a value assigned to this binding is statically the global `open` function. */
  openProv: boolean;
  /** Earliest start position of a site that gave provenance, or undefined. */
  provStart?: number;
}

/** Recursively extract identifier names from a pattern, supporting Identifier, ObjectPattern, ArrayPattern, AssignmentPattern, RestElement. */
function extractPatternNames(pattern: AstNode | null | undefined, emit: (name: string) => void): void {
  if (!pattern) return;
  switch (pattern.type) {
    case 'Identifier':
      emit(pattern.name ?? '');
      break;
    case 'ObjectPattern':
      for (const prop of (pattern as any).properties ?? []) {
        if (prop.type === 'Property') {
          extractPatternNames(prop.value, emit);
        }
      }
      break;
    case 'ArrayPattern':
      for (const elem of (pattern as any).elements ?? []) {
        extractPatternNames(elem, emit);
      }
      break;
    case 'AssignmentPattern':
      extractPatternNames((pattern as any).left, emit);
      break;
    case 'RestElement':
      extractPatternNames((pattern as any).argument, emit);
      break;
  }
}

/**
 * The lexical scope tree of one AST plus every declaration/assignment site, each recorded at
 * the lexical scope where its value expression evaluates.
 */
function buildScopes(ast: AstNode): {
  scopes: ScopeInfo[];
  bindings: Array<Map<string, Binding>>;
  nodeScopes: Map<AstNode, number>;
  declaratorSites: Array<{ binding: Binding; value: AstNode; scopeId: number; start?: number }>;
  assignmentSites: Array<{ name: string; value: AstNode; scopeId: number; start?: number }>;
} {
  const scopes: ScopeInfo[] = [{ parent: -1 }];
  const bindings: Array<Map<string, Binding>> = [new Map()];
  const nodeScopes = new Map<AstNode, number>();
  const declaratorSites: Array<{ binding: Binding; value: AstNode; scopeId: number; start?: number }> = [];
  const assignmentSites: Array<{ name: string; value: AstNode; scopeId: number; start?: number }> = [];

  const newScope = (parent: number): number => {
    scopes.push({ parent });
    bindings.push(new Map());
    return scopes.length - 1;
  };

  const declare = (name: string, scopeId: number): Binding => {
    let binding = bindings[scopeId].get(name);
    if (binding === undefined) {
      binding = { globalObj: false, openProv: false };
      bindings[scopeId].set(name, binding);
    }
    return binding;
  };


  const visit = (node: AstNode, scopeId: number, fnScope: number): void => {
    nodeScopes.set(node, scopeId);
    let childScope = scopeId;
    let childFn = fnScope;
    if (node.type === 'FunctionDeclaration' || node.type === 'FunctionExpression') {
      const inner = newScope(scopeId);
      if (node.id?.type === 'Identifier') {
        // A function declaration's name binds in the enclosing scope; an expression's name binds inside.
        declare(node.id.name ?? '', node.type === 'FunctionDeclaration' ? scopeId : inner);
      }
      for (const param of node.params ?? []) {
        // Extract identifiers from parameters, supporting patterns minimally
        extractPatternNames(param, (name) => declare(name, inner));
      }
      childScope = inner;
      childFn = inner;
    } else if (node.type === 'ArrowFunctionExpression') {
      const inner = newScope(scopeId);
      for (const param of node.params ?? []) {
        extractPatternNames(param, (name) => declare(name, inner));
      }
      childScope = inner;
      childFn = inner;
    } else if (node.type === 'BlockStatement') {
      childScope = newScope(scopeId);
    } else if (node.type === 'ForStatement' || node.type === 'ForInStatement' || node.type === 'ForOfStatement') {
      // Lexical for-loop scope for let/const declarations
      childScope = newScope(scopeId);
    } else if (node.type === 'CatchClause') {
      const inner = newScope(scopeId);
      if (node.param) {
        extractPatternNames(node.param, (name) => declare(name, inner));
      }
      childScope = inner;
    } else if (node.type === 'SwitchStatement') {
      childScope = newScope(scopeId);
    } else if (node.type === 'VariableDeclaration') {
      // var hoists to the nearest function/program scope; let and const bind lexically.
      const target = node.kind === 'var' ? fnScope : scopeId;
      for (const declarator of node.declarations ?? []) {
        if (!declarator.id) continue;
        const init = declarator.init;
        if (declarator.id.type === 'Identifier') {
          const binding = declare(declarator.id.name ?? '', target);
          if (init !== null && init !== undefined) {
            declaratorSites.push({ binding, value: init, scopeId, start: node.start });
          }
        } else if (declarator.id.type === 'ObjectPattern') {
          // Handle simple destructuring: {key: alias} or {key}
          for (const prop of (declarator.id as any).properties ?? []) {
            if (prop.type !== 'Property') continue;
            const keyName = prop.key?.type === 'Identifier' ? prop.key.name : prop.key?.type === 'Literal' ? String(prop.key.value) : null;
            if (!keyName) continue;
            const valuePat = prop.value;
            const names: string[] = [];
            extractPatternNames(valuePat, (n) => names.push(n));
            for (const name of names) {
              const binding = declare(name, target);
              // Project property access if init exists
              let projectedValue: AstNode | null = init ?? null;
              if (init && keyName) {
                if (init.type === 'ObjectExpression' && Array.isArray((init as any).properties)) {
                  const propDef = (init as any).properties.find((p: any) => {
                    const k = p.key;
                    if (!k) return false;
                    if (k.type === 'Identifier') return k.name === keyName;
                    if (k.type === 'Literal') return String(k.value) === keyName;
                    return false;
                  });
                  if (propDef && propDef.value) {
                    projectedValue = propDef.value;
                  } else {
                    projectedValue = {
                      type: 'MemberExpression',
                      computed: false,
                      object: init,
                      property: { type: 'Identifier', name: keyName }
                    } as unknown as AstNode;
                  }
                } else {
                  // Synthesize MemberExpression for property access
                  projectedValue = {
                    type: 'MemberExpression',
                    computed: false,
                    object: init,
                    property: { type: 'Identifier', name: keyName }
                  } as unknown as AstNode;
                }
              }
              if (projectedValue) {
                declaratorSites.push({ binding, value: projectedValue, scopeId, start: node.start });
              }
            }
          }
        } else if (declarator.id.type === 'ArrayPattern') {
          const elements = (declarator.id as any).elements ?? [];
          elements.forEach((elem: AstNode | null, idx: number) => {
            if (!elem) return;
            const names: string[] = [];
            extractPatternNames(elem, (n) => names.push(n));
            for (const name of names) {
              const binding = declare(name, target);
              let projectedValue: AstNode | null = init ?? null;
              if (init) {
                if (init.type === 'ArrayExpression' && Array.isArray((init as any).elements)) {
                  const elementExpr = (init as any).elements[idx];
                  projectedValue = elementExpr ?? init;
                } else {
                  projectedValue = {
                    type: 'MemberExpression',
                    computed: true,
                    object: init,
                    property: { type: 'Literal', value: idx }
                  } as unknown as AstNode;
                }
              }
              if (projectedValue) {
                declaratorSites.push({ binding, value: projectedValue, scopeId, start: node.start });
              }
            }
          });
        } else {
          // Fallback: extract names without projection
          extractPatternNames(declarator.id, (name) => {
            const binding = declare(name, target);
            if (init) {
              declaratorSites.push({ binding, value: init, scopeId, start: node.start });
            }
          });
        }
      }
    } else if (
      node.type === 'AssignmentExpression' &&
      node.right !== null &&
      node.right !== undefined
    ) {
      const left = node.left;
      if (left?.type === 'Identifier') {
        assignmentSites.push({ name: left.name ?? '', value: node.right, scopeId, start: node.start });
      } else if (left?.type === 'ObjectPattern') {
        for (const prop of (left as any).properties ?? []) {
          if (prop.type !== 'Property') continue;
          const keyName = prop.key?.type === 'Identifier' ? prop.key.name : prop.key?.type === 'Literal' ? String(prop.key.value) : null;
          if (!keyName) continue;
          const valuePat = prop.value;
          const emitName = (name: string) => {
            let valueNode: AstNode;
            if (node.right && node.right.type === 'ObjectExpression' && Array.isArray((node.right as any).properties)) {
              const propDef = (node.right as any).properties.find((p: any) => {
                const k = p.key;
                if (!k) return false;
                if (k.type === 'Identifier') return k.name === keyName;
                if (k.type === 'Literal') return String(k.value) === keyName;
                return false;
              });
              if (propDef && propDef.value) {
                valueNode = propDef.value;
              } else {
                valueNode = {
                  type: 'MemberExpression',
                  computed: false,
                  object: node.right,
                  property: { type: 'Identifier', name: keyName }
                } as unknown as AstNode;
              }
            } else {
              valueNode = {
                type: 'MemberExpression',
                computed: false,
                object: node.right,
                property: { type: 'Identifier', name: keyName }
              } as unknown as AstNode;
            }
            assignmentSites.push({ name, value: valueNode, scopeId, start: node.start });
          };
          extractPatternNames(valuePat, emitName);
        }
      } else if (left?.type === 'ArrayPattern') {
        const elements = (left as any).elements ?? [];
        elements.forEach((elem: AstNode | null, idx: number) => {
          if (!elem) return;
          const emitName = (name: string) => {
            let valueNode: AstNode;
            if (node.right && node.right.type === 'ArrayExpression' && Array.isArray((node.right as any).elements)) {
              const elementExpr = (node.right as any).elements[idx];
              valueNode = elementExpr ?? node.right;
            } else {
              valueNode = {
                type: 'MemberExpression',
                computed: true,
                object: node.right,
                property: { type: 'Literal', value: idx }
              } as unknown as AstNode;
            }
            assignmentSites.push({ name, value: valueNode, scopeId, start: node.start });
          };
          extractPatternNames(elem, emitName);
        });
      }
    }
    for (const key of Object.keys(node)) {
      if (key === 'sourceFile' || key === 'range' || key === 'loc') continue;
      const value = (node as unknown as Record<string, unknown>)[key];
      if (Array.isArray(value)) {
        for (const item of value) if (isAstNode(item)) visit(item, childScope, childFn);
      } else if (isAstNode(value)) {
        visit(value, childScope, childFn);
      }
    }
  };

  visit(ast, 0, 0);
  return { scopes, bindings, nodeScopes, declaratorSites, assignmentSites };
}

/** The final expression of a possibly-transparent callee: parentheses leave no AST node. */
function unwrapCallee(node: AstNode | null | undefined): AstNode | null {
  if (node === null || node === undefined) return null;
  let current = node;
  while (current.type === 'SequenceExpression') {
    const last = [...(current.expressions ?? [])].pop();
    if (last === undefined) return null;
    current = last;
  }
  return current;
}

/**
 * Reject any call whose statically evident function value comes from the global `open`
 * capability. Identifier and alias provenance resolve through the lexical scope tree: a bare
 * reference rejects only when it resolves to the global environment (or to a local binding that
 * itself holds the global value), and an assignment gains provenance only where its right-hand
 * side resolves to the global capability at the assignment's own scope.
 */
function assertNoGlobalOpenCall(unit: ExecutableUnit, ast: AstNode): void {
  const { scopes, bindings, nodeScopes, declaratorSites, assignmentSites } = buildScopes(ast);

  const resolveBinding = (name: string, scopeId: number): Binding | undefined => {
    for (let current = scopeId; current >= 0; current = scopes[current].parent) {
      const found = bindings[current].get(name);
      if (found !== undefined) return found;
    }
    return undefined;
  };

  /** Every value site with the binding its write targets; assignments with no visible binding are ignored. */
  const sites: Array<{ binding: Binding; value: AstNode; scopeId: number; start?: number }> = [
    ...declaratorSites,
    ...assignmentSites.flatMap((site) => {
      const binding = resolveBinding(site.name, site.scopeId);
      return binding === undefined ? [] : [{ binding, value: site.value, scopeId: site.scopeId, start: site.start }];
    })
  ];

  /** Whether one expression names a global window object in the given lexical scope. */
  function windowLikeAt(node: AstNode | null | undefined, scopeId: number): boolean {
    if (node === null || node === undefined) return false;
    if (node.type === 'Identifier') {
      const name = node.name ?? '';
      const binding = resolveBinding(name, scopeId);
      if (binding !== undefined) return binding.globalObj;
      return WINDOW_GLOBALS.has(name);
    }
    if (node.type !== 'MemberExpression' || node.computed === true) return false;
    const property = node.property;
    if (property === null || property === undefined || property.type !== 'Identifier') return false;
    const propName = property.name ?? '';
    if (node.object?.type === 'Identifier' && node.object.name === 'document' && propName === 'defaultView') {
      return resolveBinding('document', scopeId) === undefined;
    }
    return (propName === 'parent' || propName === 'top') && windowLikeAt(node.object, scopeId);
  }

  /** Whether one expression holds the global `open` function value in the given lexical scope. */
  function openProvenanceAt(node: AstNode | null | undefined, scopeId: number): boolean {
    const target = unwrapCallee(node);
    if (target === null) return false;
    if (target.type === 'Identifier') {
      const name = target.name ?? '';
      const binding = resolveBinding(name, scopeId);
      // A bare reference with no visible binding resolves to the global environment.
      return binding === undefined ? name === 'open' : binding.openProv;
    }
    if (target.type !== 'MemberExpression' || propertyName(target) !== 'open') return false;
    return windowLikeAt(target.object, scopeId);
  }

  // Fixed point: provenance flows through chains of aliases in either direction.
  let grew = true;
  while (grew) {
    grew = false;
    for (const site of sites) {
      if (!site.binding.globalObj && windowLikeAt(site.value, site.scopeId)) {
        site.binding.globalObj = true;
        grew = true;
      }
      if (!site.binding.openProv && openProvenanceAt(site.value, site.scopeId)) {
        site.binding.openProv = true;
        const s = site.start ?? Number.MAX_SAFE_INTEGER;
        if (site.binding.provStart === undefined || s < site.binding.provStart) {
          site.binding.provStart = s;
        }
        grew = true;
      }
    }
  }

  const message = `${unit.label} calls the global open(...) capability and can open a popup or secondary window.`;
  // Helper to test if an expression is a static global open reference
  function isStaticGlobalOpen(node: AstNode | null | undefined): boolean {
    if (!node) return false;
    if (node.type === 'Identifier') {
      return node.name === 'open';
    }
    if (node.type === 'MemberExpression' && !node.computed && propertyName(node) === 'open') {
      const obj = node.object;
      if (obj?.type === 'Identifier' && obj.name && WINDOW_GLOBALS.has(obj.name)) return true;
      // also allow document.defaultView.open
      if (obj?.type === 'MemberExpression' && propertyName(obj) === 'defaultView' && obj.object?.type === 'Identifier' && obj.object.name === 'document') return true;
    }
    return false;
  }
  walkAst(ast, (node) => {
    if (node.type !== 'CallExpression') return;
    const scopeId = nodeScopes.get(node) ?? 0;
    const target = unwrapCallee(node.callee);
    if (target === null) return;
    if (target.type === 'Identifier') {
      const name = target.name ?? '';
      const binding = resolveBinding(name, scopeId);
      if (binding === undefined) {
        if (name === 'open') throw new Error(message);
        return;
      }
      const callStart = node.start ?? Number.MAX_SAFE_INTEGER;
      let currentBinding = binding;
      let currentScopeId = scopeId;
      let currentCallStart = callStart;
      const visited = new Set<Binding>();
      for (let depth = 0; depth < 10; depth++) {
        if (visited.has(currentBinding)) break;
        visited.add(currentBinding);
        // Find latest write to this binding before current call
        let latestSite: typeof sites[number] | null = null;
        for (const s of sites) {
          if (s.binding === currentBinding) {
            const sStart = s.start ?? -1;
            if (sStart < currentCallStart && (!latestSite || sStart > (latestSite.start ?? -1))) {
              latestSite = s;
            }
          }
        }
        if (!latestSite) break;
        const val = latestSite.value;
        if (val.type === 'Identifier' && val.name === 'open') {
          throw new Error(message);
        }
        if (val.type === 'MemberExpression' && propertyName(val) === 'open' && windowLikeAt(val.object, latestSite.scopeId)) {
          throw new Error(message);
        }
        // Continue chain if value is an identifier alias
        if (val.type === 'Identifier') {
          const innerName = val.name ?? '';
          const innerBinding = resolveBinding(innerName, latestSite.scopeId);
          if (!innerBinding) break;
          currentBinding = innerBinding;
          currentScopeId = latestSite.scopeId;
          currentCallStart = latestSite.start ?? -1;
          continue;
        }
        // No further aliasing possible
        break;
      }
      return;
    }
    if (target.type !== 'MemberExpression') return;
    const propName = propertyName(target);
    const callStart = node.start ?? Number.MAX_SAFE_INTEGER;
    // Site-sensitive window check for open member calls
    if (propName === 'open') {
      let receiverIsWindow = false;
      if (target.object?.type === 'Identifier') {
        const recvName = target.object.name ?? '';
        const recvBinding = resolveBinding(recvName, scopeId);
        if (recvBinding) {
          let latestSite: typeof sites[number] | null = null;
          for (const s of sites) {
            if (s.binding === recvBinding) {
              const sStart = s.start ?? -1;
              if (sStart < callStart && (!latestSite || sStart > (latestSite.start ?? -1))) {
                latestSite = s;
              }
            }
          }
          if (latestSite) {
            receiverIsWindow = windowLikeAt(latestSite.value, latestSite.scopeId);
          }
        } else {
          receiverIsWindow = WINDOW_GLOBALS.has(recvName);
        }
      } else {
        receiverIsWindow = windowLikeAt(target.object, scopeId);
      }
      if (receiverIsWindow) throw new Error(message);
    }
    // Direct static invocation of the global open value through call/apply.
    if (propName === 'call' || propName === 'apply') {
      let funcHasOpenProv = false;
      if (target.object?.type === 'Identifier') {
        const fnName = target.object.name ?? '';
        const fnBinding = resolveBinding(fnName, scopeId);
        if (fnBinding) {
          // Find latest site for the function binding before call
          let currentBinding = fnBinding;
          let currentScopeId = scopeId;
          let currentCallStart = callStart;
          const visited = new Set<Binding>();
          for (let depth = 0; depth < 10; depth++) {
            if (visited.has(currentBinding)) break;
            visited.add(currentBinding);
            let latestSite: typeof sites[number] | null = null;
            for (const s of sites) {
              if (s.binding === currentBinding) {
                const sStart = s.start ?? -1;
                if (sStart < currentCallStart && (!latestSite || sStart > (latestSite.start ?? -1))) {
                  latestSite = s;
                }
              }
            }
            if (!latestSite) break;
            const val = latestSite.value;
            if (val.type === 'Identifier' && val.name === 'open') {
              funcHasOpenProv = true;
              break;
            }
            if (val.type === 'MemberExpression' && propertyName(val) === 'open' && windowLikeAt(val.object, latestSite.scopeId)) {
              funcHasOpenProv = true;
              break;
            }
            if (val.type === 'Identifier') {
              const innerName = val.name ?? '';
              const innerBinding = resolveBinding(innerName, latestSite.scopeId);
              if (!innerBinding) break;
              currentBinding = innerBinding;
              currentScopeId = latestSite.scopeId;
              currentCallStart = latestSite.start ?? -1;
              continue;
            }
            break;
          }
        } else {
          // Unbound identifier: could be global open
          funcHasOpenProv = fnName === 'open';
        }
      } else {
        funcHasOpenProv = openProvenanceAt(target.object, scopeId);
      }
      if (funcHasOpenProv) throw new Error(message);
    }
    if (
      propName === 'apply' &&
      target.object?.type === 'Identifier' &&
      target.object.name === 'Reflect' &&
      resolveBinding('Reflect', scopeId) === undefined
    ) {
      if (openProvenanceAt(node.arguments?.[0], scopeId)) throw new Error(message);
    }
  });
}

/** Run the complete bundle policy over one dist directory. Returns the process exit code. */
export async function runCheckBrowserCompat(distDir: string): Promise<number> {
  const realDist = resolve(distDir);
  try {
    await stat(realDist);
  } catch (_error) {
    console.error(`bundle-policy-missing ${realDist} is missing. Run the production build first.`);
    return 1;
  }

  let units: ExecutableUnit[];
  try {
    units = await inventoryUnits(realDist);
  } catch (error) {
    console.error(`bundle-policy-failed ${(error as Error).message}`);
    return 1;
  }

  // The app bundle itself must exist and be nonempty before any policy can hold.
  let appSource: string | null = null;
  for (const unit of units) {
    if (unit.label === 'app.js') appSource = unit.source;
  }
  if (appSource === null || appSource.length === 0) {
    console.error('bundle-policy-app-missing dist/app.js is missing or empty. Run the production build first.');
    return 1;
  }

  try {
    const index = await readFile(join(realDist, 'index.html'), 'utf8');
    if (!index.includes('window.__repjotLoadApp("./app.js?v=')) {
      console.error('bundle-policy-loader dist/index.html does not dynamically load the classic app.js bundle.');
      return 1;
    }
    const loaderDefinition = index.indexOf('window.__repjotLoadApp = function');
    const loaderCall = index.indexOf('window.__repjotLoadApp("./app.js?v=');
    const appTarget = index.indexOf('id="app"');
    if (loaderDefinition === -1 || loaderCall < loaderDefinition || loaderCall < appTarget) {
      console.error('bundle-policy-loader-order The dynamic app loader runs before its function or DOM target is ready.');
      return 1;
    }
    if (index.includes('type="module"')) {
      console.error('bundle-policy-module dist/index.html still contains a module script.');
      return 1;
    }
  } catch (_error) {
    console.error('bundle-policy-index-missing dist/index.html is missing. Run the production build first.');
    return 1;
  }

  const scopeLiterals: string[] = [];
  const scopeSinkValues: string[] = [];
  try {
    for (const unit of units) {
      const ast = parseUnit(unit);
      scopeLiterals.push(...collectScopeLiterals(ast));
      scopeSinkValues.push(...collectScopeSinks(ast));
      assertNoGlobalOpenCall(unit, ast);
    }
  } catch (error) {
    console.error(`bundle-policy-failed ${(error as Error).message}`);
    return 1;
  }

  if (scopeLiterals.length === 0 || !scopeLiterals.includes(APP_DATA_SCOPE)) {
    console.error('bundle-policy-scope the build output does not contain the required Drive app-data scope.');
    return 1;
  }
  const unexpected = [...new Set(scopeLiterals.filter((scope) => scope !== APP_DATA_SCOPE))];
  if (unexpected.length > 0) {
    console.error(
      `bundle-policy-scope the build output requests a scope other than the exact Drive app-data scope: ${unexpected.join(', ')}`
    );
    return 1;
  }

  // Sink-resolution check: every .set('scope', value) write must resolve to the exact app-data scope.
  if (scopeSinkValues.length === 0) {
    console.error('bundle-policy-scope the build output does not contain a recognized authorization scope sink.');
    return 1;
  }
  const unresolved = scopeSinkValues.includes('__UNRESOLVED__');
  const nonExact = scopeSinkValues.some((v) => v !== '__UNRESOLVED__' && v !== APP_DATA_SCOPE);
  if (unresolved || nonExact) {
    console.error('bundle-policy-scope the authorization scope sink is not exactly the Drive app-data scope.');
    return 1;
  }

  console.log(
    'dist executable output parses as ES2019, requests exactly the Drive app-data scope, and no inventoried unit contains a statically evident global open(...) call.'
  );
  return 0;
}

if (import.meta.main) {
  process.exitCode = await runCheckBrowserCompat(fileURLToPath(new URL('../dist', import.meta.url)));
}
