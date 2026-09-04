/** Phase 7 trusted-icon acceptance tests. Hostile SVG files stay under tests/, never publishable assets. */
import { describe, expect, test } from "bun:test";
import { cp, lstat, mkdtemp, readFile, realpath, symlink, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";

import {
  isSafeLocalSvgPath,
  validateSvgSource,
  validateTrustedLocalIcons
} from "../src/validation/semantic/icon-validation";
import type { IconFileAccess, IconValidationResult } from "../src/validation/semantic/icon-validation";

function codes(result: IconValidationResult): string[] {
  return result.diagnostics.map((item) => item.code);
}

function files(root: string): IconFileAccess {
  return {
    rootRealPath: () => realpath(root),
    fileRealPath: async (candidate: string) => {
      try {
        const canonical = await realpath(candidate);
        return (await lstat(canonical)).isFile() ? canonical : null;
      } catch (_error) {
        return null;
      }
    },
    readBytes: async (path: string) => new Uint8Array(await readFile(path))
  };
}

function documentWith(icon: Record<string, string>): unknown {
  return {
    format: "repjot/exercises",
    schemaVersion: 1,
    equipment: [{ id: "bar", name: "Bar", icon }],
    exercises: []
  };
}

const hostileRoot = resolve("tests/fixtures/icons/hostile");

async function hostile(name: string): Promise<string[]> {
  const source = await readFile(join(hostileRoot, name), "utf8");
  return validateSvgSource(source, "/equipment/0/icon/path").map((item) => item.code);
}

describe("SVG parser and sanitizer", () => {
  test("accepts a small inert SVG", () => {
    const result = validateSvgSource(
      '<svg xmlns="http://www.w3.org/2000/svg"><defs><path id="p" d="M0 0"/></defs><use href="#p"/></svg>',
      "/icon/path"
    );
    expect(result).toEqual([]);
  });

  test("rejects scripts, handlers, links, foreign namespaces, and event attributes", async () => {
    expect(await hostile("script.svg")).toContain("svg-forbidden-element");
    expect(await hostile("handler.svg")).toContain("svg-forbidden-element");
    expect(await hostile("ping.svg")).toContain("svg-forbidden-element");
    expect(await hostile("foreign-namespace.svg")).toContain("svg-forbidden-element");
    expect(await hostile("event.svg")).toContain("svg-event-attribute-forbidden");
  });

  test("rejects external references, mutable references, and style content", async () => {
    expect(await hostile("external-reference.svg")).toContain("svg-external-reference-forbidden");
    expect(validateSvgSource(
      '<svg xmlns="http://www.w3.org/2000/svg" xml:base="https://example.invalid/"><image href="#item"/></svg>',
      "/icon/path"
    ).map((item) => item.code)).toContain("svg-external-reference-forbidden");
    expect(validateSvgSource(
      '<svg xmlns="http://www.w3.org/2000/svg"><animate attributeName="href" to="https://example.invalid/a.svg"/></svg>',
      "/icon/path"
    ).map((item) => item.code)).toContain("svg-forbidden-element");
    expect(validateSvgSource(
      '<svg xmlns="http://www.w3.org/2000/svg"><set attributeName="href" to="https://example.invalid/a.svg"/></svg>',
      "/icon/path"
    ).map((item) => item.code)).toContain("svg-forbidden-element");
    expect(validateSvgSource(
      '<svg xmlns="http://www.w3.org/2000/svg"><rect fill="u\\72l(https://example.invalid/a.svg)"/></svg>',
      "/icon/path"
    ).map((item) => item.code)).toContain("svg-external-reference-forbidden");
    expect(validateSvgSource(
      '<svg xmlns="http://www.w3.org/2000/svg"><rect filter="u/**/rl(https://example.invalid/a.svg)"/></svg>',
      "/icon/path"
    ).map((item) => item.code)).toContain("svg-external-reference-forbidden");
    const styleCodes = await hostile("style.svg");
    expect(styleCodes).toContain("svg-style-forbidden");
  });

  test("rejects document types and malformed XML documents", async () => {
    expect(await hostile("doctype.svg")).toContain("svg-doctype-forbidden");
    expect(await hostile("malformed.svg")).toContain("svg-malformed");
    expect(await hostile("multiple-roots.svg")).toContain("svg-malformed");
    expect(await hostile("duplicate-attribute.svg")).toContain("svg-malformed");
    expect(validateSvgSource(
      '<svg xmlns="http://www.w3.org/2000/svg">\u0000</svg>',
      "/icon/path"
    ).map((item) => item.code)).toContain("svg-malformed");
  });

  test("rejects foreign event attributes and aliased XML base", async () => {
    expect(await hostile("xml-events.svg")).toContain("svg-forbidden-element");
    expect(await hostile("aliased-xml-base.svg")).toContain("svg-external-reference-forbidden");
  });
});

describe("trusted icon references", () => {
  test("checks Material Symbol names against an injected manifest", async () => {
    const root = await mkdtemp(join(tmpdir(), "repjot-icons-"));
    const result = await validateTrustedLocalIcons(documentWith({ type: "material_symbol", name: "remote_danger" }), {
      staticRoot: root,
      materialSymbols: new Set(["fitness_center"]),
      files: files(root)
    });
    expect(codes(result)).toEqual(["material-symbol-unlisted"]);
    expect(result.diagnostics[0].path).toBe("/equipment/0/icon/name");
  });

  test("accepts a listed symbol and a safe local SVG", async () => {
    const root = await mkdtemp(join(tmpdir(), "repjot-icons-"));
    await writeFile(join(root, "safe.svg"), '<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0"/></svg>');
    const local = await validateTrustedLocalIcons(documentWith({ type: "local_svg", path: "safe.svg" }), {
      staticRoot: root,
      materialSymbols: new Set(),
      files: files(root)
    });
    const material = await validateTrustedLocalIcons(documentWith({ type: "material_symbol", name: "fitness_center" }), {
      staticRoot: root,
      materialSymbols: new Set(["fitness_center"]),
      files: files(root)
    });
    expect(local.valid).toBe(true);
    expect(material.valid).toBe(true);
  });

  test("rejects schemes, absolute paths, traversal, backslashes, and missing files", async () => {
    expect(isSafeLocalSvgPath("https://example.invalid/a.svg")).toBe(false);
    expect(isSafeLocalSvgPath("/icons/a.svg")).toBe(false);
    expect(isSafeLocalSvgPath("icons/../a.svg")).toBe(false);
    expect(isSafeLocalSvgPath("icons\\a.svg")).toBe(false);

    const root = await mkdtemp(join(tmpdir(), "repjot-icons-"));
    const missing = await validateTrustedLocalIcons(documentWith({ type: "local_svg", path: "missing.svg" }), {
      staticRoot: root,
      materialSymbols: new Set(),
      files: files(root)
    });
    expect(codes(missing)).toEqual(["local-svg-missing"]);
  });

  test("rejects a symlink that resolves outside the static root", async () => {
    const parent = await mkdtemp(join(tmpdir(), "repjot-icons-"));
    const root = join(parent, "public");
    await Bun.write(join(root, ".keep"), "");
    const outside = join(parent, "outside.svg");
    await writeFile(outside, '<svg xmlns="http://www.w3.org/2000/svg"/>');
    await symlink(outside, join(root, "escape.svg"));

    const result = await validateTrustedLocalIcons(documentWith({ type: "local_svg", path: "escape.svg" }), {
      staticRoot: root,
      materialSymbols: new Set(),
      files: files(root)
    });
    expect(codes(result)).toEqual(["local-svg-outside-root"]);
  });
});

async function buildFixtureWithSvg(svgSource: string | null, iconPath: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "repjot-static-"));
  await cp(resolve("tests/fixtures/static/valid"), root, { recursive: true });
  const exercisePath = join(root, "exercises.json");
  const document = JSON.parse(await readFile(exercisePath, "utf8")) as Record<string, unknown>;
  const exercises = document["exercises"] as Array<Record<string, unknown>>;
  exercises[0]["icon"] = { type: "local_svg", path: iconPath };
  await writeFile(exercisePath, JSON.stringify(document));
  if (svgSource !== null) {
    await writeFile(join(root, "public", "hostile.svg"), svgSource);
  }
  return root;
}

function runStaticValidator(root: string): { readonly exitCode: number; readonly stderr: string } {
  const run = Bun.spawnSync(["bun", "scripts/validate-static.ts", "--fixture", root], {
    cwd: process.cwd(),
    stderr: "pipe",
    stdout: "pipe"
  });
  return { exitCode: run.exitCode, stderr: run.stderr.toString() };
}

describe("static validation command integration", () => {
  test("accepts the complete safe fixture", () => {
    expect(runStaticValidator(resolve("tests/fixtures/static/valid")).exitCode).toBe(0);
  });

  test("fails closed for traversal and a missing file", async () => {
    const traversal = await buildFixtureWithSvg(null, "icons/../outside.svg");
    const missing = await buildFixtureWithSvg(null, "missing.svg");
    expect(runStaticValidator(traversal).exitCode).not.toBe(0);
    const missingRun = runStaticValidator(missing);
    expect(missingRun.exitCode).not.toBe(0);
    expect(missingRun.stderr).toContain("local-svg-missing");
  });

  test("fails closed for active and external-reference SVG files", async () => {
    const script = await buildFixtureWithSvg(await readFile(join(hostileRoot, "script.svg"), "utf8"), "hostile.svg");
    const handler = await buildFixtureWithSvg(await readFile(join(hostileRoot, "handler.svg"), "utf8"), "hostile.svg");
    const ping = await buildFixtureWithSvg(await readFile(join(hostileRoot, "ping.svg"), "utf8"), "hostile.svg");
    const foreign = await buildFixtureWithSvg(await readFile(join(hostileRoot, "foreign-namespace.svg"), "utf8"), "hostile.svg");
    const external = await buildFixtureWithSvg(
      '<svg xmlns="http://www.w3.org/2000/svg" xml:base="https://example.invalid/"><image href="#item"/></svg>',
      "hostile.svg"
    );
    const scriptRun = runStaticValidator(script);
    const handlerRun = runStaticValidator(handler);
    const pingRun = runStaticValidator(ping);
    const foreignRun = runStaticValidator(foreign);
    const externalRun = runStaticValidator(external);
    expect(scriptRun.exitCode).not.toBe(0);
    expect(scriptRun.stderr).toContain("svg-forbidden-element");
    expect(handlerRun.exitCode).not.toBe(0);
    expect(handlerRun.stderr).toContain("svg-forbidden-element");
    expect(pingRun.exitCode).not.toBe(0);
    expect(pingRun.stderr).toContain("svg-forbidden-element");
    expect(foreignRun.exitCode).not.toBe(0);
    expect(foreignRun.stderr).toContain("svg-forbidden-element");
    expect(externalRun.exitCode).not.toBe(0);
    expect(externalRun.stderr).toContain("svg-external-reference-forbidden");
  });

  test("fails malformed XML documents and UTF-8 bytes", async () => {
    const multipleRoots = await buildFixtureWithSvg(
      await readFile(join(hostileRoot, "multiple-roots.svg"), "utf8"),
      "hostile.svg"
    );
    const duplicateAttribute = await buildFixtureWithSvg(
      await readFile(join(hostileRoot, "duplicate-attribute.svg"), "utf8"),
      "hostile.svg"
    );
    expect(runStaticValidator(multipleRoots).stderr).toContain("svg-malformed");
    expect(runStaticValidator(duplicateAttribute).stderr).toContain("svg-malformed");

    const root = await buildFixtureWithSvg("placeholder", "hostile.svg");
    const prefix = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><text>');
    const suffix = new TextEncoder().encode("</text></svg>");
    const bytes = new Uint8Array(prefix.length + 2 + suffix.length);
    bytes.set(prefix, 0);
    bytes.set([0xc3, 0x28], prefix.length);
    bytes.set(suffix, prefix.length + 2);
    await writeFile(join(root, "public", "hostile.svg"), bytes);
    const run = runStaticValidator(root);
    expect(run.exitCode).not.toBe(0);
    expect(run.stderr).toContain("svg-malformed");
  });
});
