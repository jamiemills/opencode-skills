import { resolveConsumerInput } from "../../lib/consumer-adapters/index.mjs";

export function resolveResearchInput(input, options = {}) {
  return resolveConsumerInput("research->make-tests", input, options);
}
