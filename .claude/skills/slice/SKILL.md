---
name: slice
description: Build the next (or a named) slice of docs/28_SLICE_PLAN.md end to end — worktree, slice brief, slice-dev and slice-tester agents, all gates, migration check, docs, commit and fast-forward into local main, cleanup, screenshots, report. Use when the user says "do next slice", "do slice M3.2", "next", or similar.
---

# Build a slice

You are the orchestrator. The **slice-dev** agent builds; the **slice-tester** agent tests independently; you write the brief, settle decisions with the user, keep the two in step, verify, and finish. Arguments: a slice id such as `M2.5`; none means the first slice in `docs/28_SLICE_PLAN.md` that `docs/16_IMPLEMENTATION_PLAN.md` does not mark done.

## Standing rules

- The user runs `pnpm dev` in `D:\fitness-crm`: never stop it, never run installs, migrations, or builds there. Everything happens in the worktree.
- Never push. Never state passwords or keys in chat. The repo is public.
- Never run `git checkout -- .`, `git reset --hard`, or `git clean` in a worktree with uncommitted work.

## 1. Worktree

```bash
cd /d/fitness-crm
git worktree add -q ../fitness-crm-<id> -b <id>            # id like m2s5
cp apps/api/.env ../fitness-crm-<id>/apps/api/.env
cp apps/web/.env ../fitness-crm-<id>/apps/web/.env
cd ../fitness-crm-<id> && corepack pnpm install
mkdir .slice                                                  # git-ignored hand-off folder
```

## 2. Slice brief — `.slice/brief.md`

From the plan's section, the brief sections it cites, doc 18, and the current code, write (AGENTS.md §6 steps 1–4):

1. **Requirement** in a few lines, citing brief §n, FR, BR, AC.
2. **Rules and decisions** that apply (D/T/A ids) and open questions with their interim behavior.
3. **Files and modules** to change, and the existing code to copy.
4. **Decide first** — each item with a proposed answer. Items that can change money, session consumption, PT pay, or permissions go to the user with AskUserQuestion (recommended option first) **before any code**; record the answers. Other items become A-entries with the proposal.
5. **Tests** — the plan's Tests line, expanded into scenarios with expected results and sources.
6. **Out of scope.**

If the slice is bigger than one sitting, split it in `docs/28_SLICE_PLAN.md` first and tell the user.

## 3. Phase A — contract (foreground)

Spawn `slice-dev` with the worktree path and: "Phase A of `.slice/brief.md`: schema, migration, shared schemas, controller signatures, OpenAPI; write `.slice/contract.md`." Read the contract; fix anything that contradicts the brief before going on.

## 4. Phase B — build and test in parallel (background)

Spawn both in the background, each with the worktree path:

- `slice-dev`: "Phase B of `.slice/brief.md` against `.slice/contract.md`. Do not run DB-backed suites."
- `slice-tester`: "Write the integration, E2E, and security tests for `.slice/brief.md` from the contract. Do not run DB-backed suites until told."

Answer their questions as they come (SendMessage keeps their context). A question that is a business rule goes to the user, not to your guess.

## 5. Phase C — verify and fix

When the developer reports done, tell the tester to run everything (`slice-verify` §1–2). Product bugs land in `.slice/bugs.md`; send them to `slice-dev` to fix, then have the tester re-run what failed and finally the full suites. Settle "disputed" and "question" entries from the sources or with the user. After three rounds without green, stop and report to the user with the failing output.

Then run `slice-verify` §3 yourself (migrations on the dev copy).

## 6. Review

Read the whole diff (`git diff main --stat`, then the files) against `docs/17_AI_AGENT_WORKFLOW.md`'s review list: money, session consumption, authorization, concurrency, data consistency, scope and masking, layering, missing tests. Fix-ups go back to the agent that owns the file.

## 7. Docs

Check that the slice left them consistent: doc 16 progress row (**Done** + date), doc 28 slice marked done, doc 18 entries, docs 04/05/06/07/09/13/24/25 where touched, `CHANGELOG.md` entry with the test counts.

## 8. Screenshots

Ask `slice-tester` for a throwaway `e2e/zz-shots.branch.spec.ts` that saves screenshots of the new screens (desktop, and phone where the slice is phone-first) into the scratchpad, run it once, delete the spec, and send the images with SendUserFile.

## 9. Commit, merge, clean up

```bash
cd /d/fitness-crm-<id>
git add -A -- . ':!.slice'
git commit -F - <<'EOF'
M<x> slice <n>: <title>

<what it does, in the brief's terms, with decision ids>

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
cd /d/fitness-crm
git merge --ff-only <id>
git worktree remove --force ../fitness-crm-<id>; git worktree prune
git branch -d <id>
docker exec fitness-crm-postgres psql -U fitness -d postgres -c "DROP DATABASE IF EXISTS fitness_crm_<id>check"
```

If `main` moved, rebase the branch onto it first and re-run the gates. Don't commit files the user left untracked in `D:\fitness-crm`.

## 10. Report to the user

Plain language, short:

- What the slice does, as the gym staff will see it.
- The test table (suite → counts; E2E ×3).
- Choices recorded in doc 18 (ids, one line each) and open questions for the owner.
- **Their dev environment:** what to do before restarting `pnpm dev` — new settings in `.env` (give the command, never a secret value), `pnpm install` when dependencies changed, `pnpm db:deploy` with the pending migration names.
- The next slice in the plan.
