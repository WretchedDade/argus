# Author calibration

Calibration changes how you word a finding. It never changes what you flag, the
severity, or the verdict. The same defect gets the same severity for every author.

## Recommend a calibration

Before you draft the first comment, recommend one calibration and ask the
reviewer to confirm or choose another. Ask once for the whole review, never per
comment. Give the reason with the recommendation. Never apply one without asking,
unless the reviewer or the kickoff prompt already named one.

Use these signals, in order:

1. The author's display name has a company in parentheses, for example
   `Jo Lee (Contoso Services)`. In many Azure DevOps organizations this suggests
   an external contractor, but it is only a hint. Say "looks like", not "is".
   Recommend **Explain**.
2. The author is on the reviewer's team, or has at least 3 commits by that author
   on the default branch in the last 90 days. Check with local `git log`. Do not
   query Azure DevOps for this. Recommend **Compress**.
3. Otherwise recommend **Neutral**. Do not guess from the author's name or
   tenure.

The signals only support a recommendation. The reviewer can also describe their
own calibration in plain words. Follow it. The reviewer can change the choice for
a single comment.

## Neutral (default)

State the issue, the impact, and a suggested fix. Add the reason only when it is
not obvious from the code.

## Explain (author may lack team context)

Make implicit team knowledge explicit. A teammate would know it without help.

- Name the convention or rule, and say where it is written down or where an
  example lives in the repo. Cite only a path you opened. If you found none, say
  the convention is unwritten. Do not invent a source.
- Say why it matters here, in one sentence.
- Give a concrete fix, or point to a similar change in the repo.
- Keep a respectful, collaborative tone. Explaining is not lecturing.

## Compress (author knows the codebase)

Point at the problem. Do not teach it back to the author.

- One or two sentences: the issue and the fix.
- Skip background the author already knows.
- Drop praise that has no content. Keep specific praise.

## Rules for every calibration

- Same findings, same severity, same verdict.
- Do not lower the bar for one author and raise it for another.
- Never mention the calibration in a comment you post.

## Example

Finding: a new endpoint reads `request.UserId` and never checks that the caller
owns the record.

- **Compress:** `GetRecord` skips the ownership check, so any caller can read any
  record. Use `AuthorizeOwner(record, caller)` like `UpdateRecord`.
- **Explain:** This endpoint returns a record without checking that the caller
  owns it. In this repo every read path calls `AuthorizeOwner` before it returns
  data, so one user cannot read another user's records (see `UpdateRecord`). Please
  add the same call here.
