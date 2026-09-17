#!/usr/bin/env python3
"""Find identifiers a plugin uses but never declares.

`node --check` proves a file parses; it says nothing about whether every name in
it exists. The renderer loads `desktop/plugin.js` raw, so a stale reference — an
identifier left behind by a rename, like a `settings.alertDelivery` that became a
bare `alertDelivery` — parses fine and then throws `ReferenceError: … is not
defined` at render, where the error boundary catches it and the pane is replaced
by "failed to render". That is a whole debugging round-trip for a typo.

This is a heuristic, not a compiler: it collects every declaration it can see
(functions, const/let/var including destructuring, parameters, imports, class
names) and every identifier used, then subtracts the language's own globals and
anything reached through a dot. Object keys (a name followed by `:`) are keys,
not references. A short list of known false positives is allowed explicitly.

Usage:  python3 tools/lint_plugin_js.py desktop/plugin.js
Exit 1 when something is used and never declared.
"""

from __future__ import annotations

import re
import sys

# Words that are part of the language, or globals this file may legitimately use
# without declaring them anywhere.
GLOBALS = {
    # keywords and operators that survive a naive identifier scan
    "as", "async", "await", "break", "case", "catch", "class", "const", "continue",
    "debugger", "default", "delete", "do", "else", "export", "extends", "false",
    "finally", "for", "from", "function", "get", "if", "import", "in", "instanceof",
    "let", "new", "null", "of", "return", "set", "static", "super", "switch", "this",
    "throw", "true", "try", "typeof", "undefined", "var", "void", "while", "with",
    "yield", "arguments",
    # platform globals
    "Array", "Boolean", "Date", "Error", "Infinity", "JSON", "Map", "Math", "NaN",
    "Number", "Object", "Promise", "RegExp", "Set", "String", "Symbol", "URL",
    "clearInterval", "clearTimeout", "console", "decodeURIComponent", "document",
    "encodeURIComponent", "fetch", "globalThis", "isFinite", "isNaN", "localStorage",
    "navigator", "parseFloat", "parseInt", "requestAnimationFrame", "setInterval",
    "setTimeout", "structuredClone", "window",
    # react's automatic JSX runtime, injected by the loader
    "jsx", "jsxs", "Fragment",
}

# Names this scan cannot see a declaration for, checked by eye and accepted.
ALLOWED = set()

DECL = [
    re.compile(r"\bfunction\s+([A-Za-z_$][\w$]*)"),
    re.compile(r"\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)"),
    # const { a, b: c, d = 1 } = … and const [a, setA] = …
    re.compile(r"\b(?:const|let|var)\s*\{([^}]*)\}"),
    re.compile(r"\b(?:const|let|var)\s*\[([^\]]*)\]"),
    # function f(a, b = 1, { c }) — parameters, including destructured ones
    re.compile(r"\bfunction\s+[A-Za-z_$][\w$]*\s*\(([^)]*)\)"),
    # object/class method shorthand: `register(ctx) { … }` — the name is a property,
    # not a binding, but treating it as declared keeps the scan honest about
    # parameters without inventing "used but never declared" for the method itself
    re.compile(r"^[ \t]*(?:async\s+)?([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*\{", re.M),
    re.compile(r"^[ \t]*(?:async\s+)?[A-Za-z_$][\w$]*\s*\(([^)]*)\)\s*\{", re.M),
    # arrows: (a, b) => … and single-argument a => …
    re.compile(r"\(([^()]*)\)\s*=>"),
    re.compile(r"\b([A-Za-z_$][\w$]*)\s*=>"),
    # import { A, B as C } from '…'
    re.compile(r"\bimport\s*\{([^}]*)\}", re.S),
    re.compile(r"\bclass\s+([A-Za-z_$][\w$]*)"),
    # catch (error) / for (const x of …)
    re.compile(r"\bcatch\s*\(([^)]*)\)"),
]

NAME = re.compile(r"[A-Za-z_$][\w$]*")
USE = re.compile(r"(?<![\w$.])([A-Za-z_$][\w$]*)(?![\w$])")


def declared_names(source: str) -> set[str]:
    names: set[str] = set()

    for pattern in DECL:
        for match in pattern.finditer(source):
            # A method shorthand's first group is the method NAME, not a binding;
            # its parameters are in the second group.
            groups = match.groups()
            if len(groups) > 1 and groups[1] is not None:
                payload = groups[1]
            else:
                payload = groups[0] if groups else ""
            if payload in (None, ""):
                continue
            for piece in re.split(r"[,\s]+", payload):
                piece = piece.split("=")[0].split(":")[-1].strip()
                if NAME.fullmatch(piece or ""):
                    names.add(piece)

    return names


def blank(text: str) -> str:
    """A same-length stand-in that keeps newlines, so line numbers stay true."""

    return "\n" * text.count("\n") + " "


def strip_strings_and_comments(source: str) -> str:
    """Blanks out strings, templates and comments, keeping every newline.

    Line numbers have to survive: the report points at lines the reader will open.
    """

    out = []
    i = 0
    length = len(source)

    while i < length:
        char = source[i]
        nxt = source[i + 1] if i + 1 < length else ""

        if char == "/" and nxt == "/":
            end = source.find("\n", i)
            end = length if end == -1 else end
            out.append(blank(source[i:end]))
            i = end
            continue

        if char == "/" and nxt == "*":
            end = source.find("*/", i + 2)
            end = length if end == -1 else end + 2
            out.append(blank(source[i:end]))
            i = end
            continue

        if char == "/" and nxt not in "/*":
            # A regex literal, not division: only where a value can start.
            previous = out[-1].rstrip() if out else ""
            if not previous or (len(previous) and previous[-1] in "(,=:[!&|?{};+*%~^<>"):
                start = i
                i += 1
                in_class = False
                while i < length:
                    if source[i] == "\\":
                        i += 2
                        continue
                    if source[i] == "[":
                        in_class = True
                    elif source[i] == "]":
                        in_class = False
                    elif source[i] == "/" and not in_class:
                        i += 1
                        break
                    elif source[i] == "\n":
                        break
                    i += 1
                # Flags ride along: /…/gi
                while i < length and source[i].isalpha():
                    i += 1
                out.append(blank(source[start:i]))
                continue

        if char in "'\"`":
            quote = char
            start = i
            i += 1
            # Templates keep their ${…} interpolation: that is live code.
            while i < length and source[i] != quote:
                if source[i] == "\\":
                    i += 2
                    continue
                if quote == "`" and source[i] == "$" and i + 1 < length and source[i + 1] == "{":
                    out.append(blank(source[start:i]))
                    depth = 1
                    i += 2
                    inner = i
                    while i < length and depth:
                        if source[i] == "{":
                            depth += 1
                        elif source[i] == "}":
                            depth -= 1
                        i += 1
                    # Spaced, so interpolated code cannot glue itself to the
                    # literal text around it and invent an identifier.
                    out.append(" ")
                    out.append(strip_strings_and_comments(source[inner : i - 1]))
                    out.append(" ")
                    start = i
                    continue
                i += 1
            i += 1
            out.append(blank(source[start:i]))
            continue

        out.append(char)
        i += 1

    return "".join(out)


def main() -> int:
    path = sys.argv[1] if len(sys.argv) > 1 else "desktop/plugin.js"
    raw = open(path, encoding="utf-8").read()
    source = strip_strings_and_comments(raw)
    declared = declared_names(source) | GLOBALS | ALLOWED
    missing: dict[str, list[int]] = {}

    for number, line in enumerate(source.splitlines(), start=1):
        # Object keys and labels are written `name:` and never read as variables.
        line = re.sub(r"([A-Za-z_$][\w$]*)\s*:", " ", line)
        for name in USE.findall(line):
            if name not in declared:
                missing.setdefault(name, []).append(number)

    if missing:
        print(f"{path}: {len(missing)} identifier(s) used but never declared:")
        for name, lines in sorted(missing.items()):
            where = ", ".join(str(n) for n in lines[:6])
            print(f"  {name}  (line {where})")
        return 1

    print(f"{path}: every identifier is declared ✅")
    return 0


if __name__ == "__main__":
    sys.exit(main())
