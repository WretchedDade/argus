import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { automaticReviewPrompt, reviewPrompt } from "./api.ts";
import { shouldShowAutomaticReview } from "../src/lib/triage.ts";
import type { Pr } from "./types.ts";

assert.equal(shouldShowAutomaticReview({ lane: "quick" }), true);
assert.equal(shouldShowAutomaticReview({ lane: "review" }), false);

const prompt = automaticReviewPrompt({
  repo: "LPE.UI",
  number: 123,
  title: "Test automatic review",
  canonical: "https://example.test/pr/123",
} as Pr, "pr-review");
assert.match(prompt, /Review mode: automatic/);
assert.match(prompt, /coordinate_with_creator: false/);
assert.match(prompt, /kickoff\.mode: "autopilot"/);
assert.match(prompt, /in-depth full review/);
assert.match(prompt, /rely on the PR's existing Azure DevOps build\/check status and test results/);
assert.match(prompt, /must not run local test suites, builds, linters, typechecks/);
assert.match(prompt, /Missing, running, inaccessible, or failed CI evidence means validation is incomplete/);

const interactivePrompt = reviewPrompt({
  repo: "LPE.UI",
  number: 123,
  title: "Test interactive review",
  canonical: "https://example.test/pr/123",
  lane: "quick",
} as Pr, "pr-review");
assert.doesNotMatch(interactivePrompt, /Review mode: automatic|kickoff\.mode: "autopilot"/);

for (const path of [
  "../../../skills/pr-review/SKILL.md",
  "../skills/pr-review/SKILL.md",
]) {
  const skill = readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8").replace(/\s+/g, " ");
  assert.match(skill, /Review mode: automatic/);
  assert.match(skill, /zero findings/);
  assert.match(skill, /validation is complete and confident/);
  assert.match(skill, /post no ADO comments/);
  assert.match(skill, /cast no ADO vote/);
  assert.match(skill, /rely on the PR's existing Azure DevOps build\/check status and test results/);
  assert.match(skill, /[Dd]o not run local test suites, builds, linters, typechecks/);
  assert.match(skill, /missing, still running, inaccessible, or failed, validation is incomplete/i);
}

console.log("automatic review self-check OK");
