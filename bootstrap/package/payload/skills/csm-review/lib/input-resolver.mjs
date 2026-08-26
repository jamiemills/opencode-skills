import { resolveConsumerInput } from "../../../lib/consumer-adapters/index.mjs";

export function resolveReviewInput(input, options = {}) {
  return resolveConsumerInput("scan->review", input, options);
}
