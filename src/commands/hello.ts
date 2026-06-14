import { Effect } from "effect";
import { command } from "../command-lib.js";

// The simplest possible command: no inputs, a constant reply.
export const hello = command({
  name: "hello",
  description: "Say hello",
  execute: () => Effect.succeed("Hello, World! 👋"),
});
