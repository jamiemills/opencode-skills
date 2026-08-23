import { planWork } from "../planning/index.mjs";
import process from "node:process";
const region = process.env.SAMPLE_REGION ?? "local";
export function scan(target) {
  return planWork([target, region]);
}
