import type { ComponentType } from "react";
import { WobbleDefs } from "./WobbleDefs.tsx";

/** A Tutor root component that also keeps the kit's defs in the page while it is mounted. */
export function withWobbleDefs<P extends object>(Component: ComponentType<P>): ComponentType<P> {
  function WithWobbleDefs(props: P) {
    return (
      <>
        <WobbleDefs />
        <Component {...props} />
      </>
    );
  }
  WithWobbleDefs.displayName = `withWobbleDefs(${Component.displayName ?? Component.name})`;
  return WithWobbleDefs;
}
