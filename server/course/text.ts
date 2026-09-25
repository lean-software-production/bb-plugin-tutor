// Small text helpers shared by the course readers.

/** Removes the indentation common to every non-blank line, and blank lines at either end. */
export function dedent(text: string): string {
  const lines = text.split("\n");
  const indents = lines
    .filter((line) => line.trim() !== "")
    .map((line) => line.length - line.trimStart().length);
  const common = indents.length === 0 ? 0 : Math.min(...indents);
  return lines
    .map((line) => line.slice(common).trimEnd())
    .join("\n")
    .replace(/^\n+|\n+$/g, "");
}
