"use strict";

const proposalRequest = (id = "fixture", content = "improve the objective") => ({
  id,
  content,
  maxProposals: 5,
  seed: "fixture-seed",
});
const judgeRequest = (id = "judge-fixture") => ({
  id,
  comparison: "pairwise",
  seed: "fixture-seed",
  candidates: [
    { id: "a", content: "clear baseline" },
    { id: "b", content: "alternate approach" },
    { id: "c", content: "third approach" },
  ],
});

export { proposalRequest, judgeRequest };
