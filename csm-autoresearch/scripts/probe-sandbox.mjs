"use strict";

import { probeSandbox } from "../lib/providers/generated.mjs";

const result = probeSandbox();
process.stdout.write(`${JSON.stringify(result)}\n`);
if (process.argv.includes("--required") && result.status !== "available") process.exitCode = 1;
