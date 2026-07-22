# Evaluation protocol

Use equivalent fresh sessions and the same model, repository state, prompt, permissions, and verification command.

Record for each arm:

- input and output tokens;
- elapsed time and cost;
- task completion and test results;
- changed lines and regressions;
- number of full archive restores;
- critical facts lost by compression.

Compare at least these arms: baseline Codex, Ponytail, Token Razor, and Ponytail plus Token Razor. Run multiple repetitions and report the median plus range. A result is better only if it reduces total tokens without lowering completion or safety.

`npm run bench` is a fast component test. It does not replace end-to-end session evaluation.
