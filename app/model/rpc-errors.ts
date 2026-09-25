// Tells a lost connection to the Codespace apart from a real Tutor or BB error.
//
// BB's plugin RPC route always answers with a JSON body, and BB's frontend
// client turns that body's message into the Error it throws. When something
// in front of BB answers instead (GitHub's port-forwarding proxy once the
// Codespace has stopped or the forwarded-port session has expired: an empty
// 401, a 502 page, a login redirect), there is no JSON error to read, and the
// client throws a generic `rpc "<method>" failed (HTTP <status>)` with no
// `code`. A network failure makes fetch throw a TypeError. Both mean the page
// has lost BB, and the student can only reload.

export const CONNECTION_LOST_MESSAGE =
  "Lost the connection to your Codespace — it may have stopped after being idle. Reload this page (and restart the Codespace if needed).";

export class ConnectionLostError extends Error {
  readonly kind = "connection-lost";

  constructor(cause: unknown) {
    super(CONNECTION_LOST_MESSAGE, { cause });
    this.name = "ConnectionLostError";
  }
}

/** The message BB's client throws when the response carried no BB JSON error. */
const NON_BB_RESPONSE = /^rpc "[^"]*" failed \(HTTP \d{3}\)$/;

/** A ConnectionLostError for a failure that did not come from BB, otherwise `cause` unchanged. */
export function classifyRpcFailure(cause: unknown): unknown {
  if (cause instanceof ConnectionLostError) return cause;
  if (cause instanceof TypeError) return new ConnectionLostError(cause);
  if (cause instanceof Error && !("code" in cause) && NON_BB_RESPONSE.test(cause.message)) {
    return new ConnectionLostError(cause);
  }
  return cause;
}

/** For surfaces that keep only the error's message (the query cache, action state). */
export function isConnectionLost(message: string | null): boolean {
  return message === CONNECTION_LOST_MESSAGE;
}

interface RpcClientLike {
  call(...args: never[]): Promise<unknown>;
}

/** The same client, with every failure passed through classifyRpcFailure. */
export function withConnectionLossDetection<C extends RpcClientLike>(client: C): C {
  const call = (...args: never[]) =>
    client.call(...args).catch((cause: unknown) => {
      throw classifyRpcFailure(cause);
    });
  return { ...client, call } as C;
}
