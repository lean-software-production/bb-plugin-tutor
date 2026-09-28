import type { CSSProperties } from "react";
import { icons, type IconName } from "../../sketch/drawings.ts";
import { cx } from "../../sketch/tone.ts";

type KitIconProps = {
  name: IconName;
  /** Only when the icon carries meaning the text beside it does not. */
  alt?: string;
  className?: string;
  style?: CSSProperties;
};

/** One of the brand's drawn icons, as the whole vendored file (styles/atoms.css `.tp-drawing`). */
export function KitIcon({ name, alt = "", className, style }: KitIconProps) {
  return (
    <span className={cx("tp-drawing", className)} style={style}>
      <img src={icons[name]} alt={alt} />
    </span>
  );
}
