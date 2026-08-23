# Deferred liability: csm-ddd description vs the token-efficiency budget

The AGENTS.md stable-prefix regime budgets skill frontmatter descriptions at a
fixed word total (220 at the time that rule was written) and forbids volatile
tokens. Token efficiency is currently DISABLED for this repo
(`.agents/token-efficiency.json` = `{"enabled": false}`), so neither check runs;
the measured description total across all twelve skills already exceeds 220.

When token efficiency is re-enabled:

1. The volatile-token check must pass for `csm-ddd`'s description — it was
   written volatile-free (no dates, versions, `$ENV`, absolute paths), so it is
   expected to pass unchanged.
2. The word-budget check WILL fail until the total is re-budgeted to include
   csm-ddd's ~33-word description. Re-budgeting is an explicit, separate task
   (per plan A8 of `.agents/plans/2026-08-23-csm-ddd-skill-csm.md`): pick which
   descriptions to trim so the new total lands on budget, then update
   AGENTS.md's stated total in the same commit.

Owner: whoever re-enables the toggle. Do not enable without scheduling step 2.
