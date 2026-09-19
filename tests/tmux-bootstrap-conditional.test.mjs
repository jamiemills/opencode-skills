import assert from "node:assert/strict";
import test from "node:test";
import { SYNC_SECTIONS } from "../scripts/lib/boilerplate.mjs";

const tmuxSkills = Object.entries(SYNC_SECTIONS)
  .filter(([, sections]) => sections["Tmux Session Bootstrap"])
  .map(([skill, sections]) => ({ skill, render: sections["Tmux Session Bootstrap"].render }));

function step(body, n) {
  const line = body.split("\n").find((l) => new RegExp(`^${n}\\. `).test(l));
  assert.ok(line, `step ${n} present`);
  return line;
}

test("every synced tmux bootstrap names the agent-session guard", () => {
  assert.ok(tmuxSkills.length >= 8, `expected >=8 tmux skills, got ${tmuxSkills.length}`);
  for (const { skill, render } of tmuxSkills) {
    const body = render();
    assert.match(body, /CSM_AGENT_SESSION_EXEC=1/, `${skill}: names CSM_AGENT_SESSION_EXEC`);
    assert.match(body, /CSM_AGENT_SESSION_\*/, `${skill}: names the CSM_AGENT_SESSION_* family`);
    assert.match(body, /agent session/i, `${skill}: describes the agent session`);
  }
});

test("step 3 is skipped inside an agent session and continues in-process", () => {
  for (const { skill, render } of tmuxSkills) {
    const step3 = step(render(), 3);
    assert.match(step3, /agent session/i, `${skill}: step 3 is agent-session conditional`);
    assert.match(
      step3,
      /CSM_AGENT_SESSION_/,
      `${skill}: step 3 checks a CSM_AGENT_SESSION_* marker`,
    );
    assert.match(step3, /skip this step and step 4/i, `${skill}: step 3 skips step 4`);
    assert.match(step3, /in-process/i, `${skill}: step 3 continues in-process`);
    assert.match(
      step3,
      /Otherwise, if not in tmux/,
      `${skill}: step 3 still handles the human CLI`,
    );
  }
});

test("step 4 only ends the invocation for an interactive human CLI", () => {
  for (const { skill, render } of tmuxSkills) {
    const body = render();
    const step4 = step(body, 4);
    assert.match(
      step4,
      /Only if .* no agent-session marker is set \(an interactive human CLI\) end the invocation/i,
      `${skill}: step 4 guards the end on the human CLI`,
    );
    assert.match(
      step4,
      /never end the invocation/i,
      `${skill}: step 4 never ends inside an agent session`,
    );
    assert.match(step4, /in-process/i, `${skill}: step 4 continues in-process otherwise`);
    assert.doesNotMatch(
      body,
      /If a new detached session was launched, end the invocation/,
      `${skill}: no unconditional end remains`,
    );
  }
});
