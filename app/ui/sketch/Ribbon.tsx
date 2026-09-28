import type { ReactNode } from "react";
import { icons, type IconName } from "../../sketch/drawings.ts";
import { cx } from "../../sketch/tone.ts";

type RibbonProps = {
  icon?: IconName;
  /** The lead-in, in the label face: "Lesson 0 done." */
  kicker?: ReactNode;
  children?: ReactNode;
  className?: string;
};

/** The kit's paper ribbon banner. It unfurls once (tp-ribbon, app/styles/motion.css); still under reduced motion. */
export function Ribbon({ icon, kicker, children, className }: RibbonProps) {
  return (
    <div className={cx("sk-ribbon", "tp-ribbon", className)}>
      {icon && <img src={icons[icon]} alt="" />}
      {kicker && <span className="sk-kicker">{kicker}</span>}
      {children}
    </div>
  );
}
