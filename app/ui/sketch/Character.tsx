import type { CSSProperties } from "react";
import { characters, type CharacterName } from "../../sketch/drawings.ts";
import { Patch } from "./Patch.tsx";

type CharacterProps = {
  name: CharacterName;
  /** Only when the drawing carries meaning the text beside it does not. */
  alt?: string;
  className?: string;
  style?: CSSProperties;
};

/** One of the brand's characters, on its paper patch. */
export function Character({ name, alt = "", className, style }: CharacterProps) {
  return (
    <Patch className={className} style={style}>
      <img src={characters[name]} alt={alt} />
    </Patch>
  );
}
