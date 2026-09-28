import type { CSSProperties } from "react";
import { icons, type IconName } from "../../sketch/drawings.ts";
import { Patch } from "./Patch.tsx";

type KitIconProps = {
  name: IconName;
  /** Only when the icon carries meaning the text beside it does not. */
  alt?: string;
  className?: string;
  style?: CSSProperties;
};

/** One of the brand's drawn icons, on its paper patch. */
export function KitIcon({ name, alt = "", className, style }: KitIconProps) {
  return (
    <Patch className={className} style={style}>
      <img src={icons[name]} alt={alt} />
    </Patch>
  );
}
