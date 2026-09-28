import type { CSSProperties } from "react";
import { characters, type CharacterName } from "../../sketch/drawings.ts";
import { cx } from "../../sketch/tone.ts";

type CharacterProps = {
  name: CharacterName;
  /** Only when the drawing carries meaning the text beside it does not. */
  alt?: string;
  className?: string;
  style?: CSSProperties;
};

/** One of the brand's characters, as the whole vendored file (styles/atoms.css `.tp-drawing`). */
export function Character({ name, alt = "", className, style }: CharacterProps) {
  return (
    <span className={cx("tp-drawing", className)} style={style}>
      <img src={characters[name]} alt={alt} />
    </span>
  );
}
