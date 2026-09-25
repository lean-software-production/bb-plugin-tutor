// YAML reading with error messages that name the file and line.
import { LineCounter, isNode, parseDocument } from "yaml";
import { CourseLoadError } from "../../shared/ports.ts";

export interface YamlFile {
  data: unknown;
  /** The line of the node at `path`, or of its nearest ancestor that exists. */
  lineOf(path: readonly PropertyKey[]): number;
}

/**
 * `failsafe` reads every scalar as a string, so `id: 001` stays "001" rather
 * than becoming the number 1.
 */
export function readYaml(text: string, displayPath: string, schema: "core" | "failsafe"): YamlFile {
  const lineCounter = new LineCounter();
  const document = parseDocument(text, { lineCounter, schema, prettyErrors: false });
  const [error] = document.errors;
  if (error !== undefined) {
    const line = lineCounter.linePos(error.pos[0]).line;
    const message = error.message.split("\n")[0] ?? error.message;
    throw new CourseLoadError(`Could not read ${displayPath}, line ${line}: ${message}`);
  }
  return {
    data: document.toJS(),
    lineOf(path) {
      for (let length = path.length; length > 0; length -= 1) {
        const node = document.getIn(path.slice(0, length), true);
        if (isNode(node) && node.range) return lineCounter.linePos(node.range[0]).line;
      }
      return 1;
    },
  };
}
