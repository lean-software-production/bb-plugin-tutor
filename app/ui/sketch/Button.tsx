import type { ComponentPropsWithoutRef } from "react";
import { cx } from "../../sketch/tone.ts";

type Common = { secondary?: boolean };
type AsButton = Common & ComponentPropsWithoutRef<"button"> & { href?: undefined };
type AsLink = Common & ComponentPropsWithoutRef<"a"> & { href: string };

/** The kit's button: a real <button>, or an <a> when it has an `href`. Primary is filled; `secondary` is outlined. */
export function Button(props: AsButton | AsLink) {
  if (props.href !== undefined) {
    const { secondary, className, ...rest } = props;
    return <a className={cx("sk-btn", secondary && "sk-secondary", className)} {...rest} />;
  }
  const { secondary, className, type = "button", ...rest } = props;
  return <button type={type} className={cx("sk-btn", secondary && "sk-secondary", className)} {...rest} />;
}
