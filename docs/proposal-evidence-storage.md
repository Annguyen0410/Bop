# Proposal — where `experiments/**/evidence` should live

**Status:** proposed, **deferred**. Measured 23 November 2026; nothing has been moved.

## What is there, measured

| What | Count | Size |
| --- | --- | --- |
| `experiments/` in the working tree | — | **9.7 MB** |
| `experiments/bubble-waitroom/evidence/` (logcat, SystemUI/window dumps, PNG captures) | 131 files | **9.6 MB** |
| Blobs tracked under `experiments/` in git | 146 files | **19 904 856 bytes** (~19 MB) |

Commands:

```bash
du -sh experiments
git ls-files experiments | wc -l
git ls-files -s experiments | awk '{print $2}' | xargs -I{} git cat-file -s {} | awk '{s+=$1} END {print s}'
```

Nothing in the documentation links to an individual evidence file. The only reference is the README's
repository-layout row, which links the `experiments/` directory itself. So relocating the *contents*
breaks no link; deleting the directory would.

## The constraint that makes this awkward

The 19 MB is not only in the working tree — it is in **history**, and history can only be shrunk by
rewriting it. Rewriting changes every commit hash after the first rewritten commit, which would break
the audit baseline pinned in the reliability reports (`main @ 392637c`), every hash quoted in
`docs/verification.md` and `docs/evidence/`, and any clone or fork that exists. That is why this is a
proposal and not a change.

## Options

1. **Release assets (recommended).** Zip `experiments/bubble-waitroom/evidence/` once, attach it to a
   GitHub release (`evidence-bubble-waitroom-2026-10.zip`), replace the folder in `experiments/` with a
   `README.md` that links the asset and lists what it contains, and add `experiments/**/evidence/` to
   `.gitignore` so the next lab run does not re-add 10 MB. History keeps its blobs — the clone size does
   not shrink — but the repository stops growing and the evidence stays public and linkable.
   *Cost:* one release upload and one commit. *Risk:* none to history.
2. **Git LFS.** `git lfs migrate import` rewrites history (same breakage as above), and every existing
   clone must install LFS and re-clone. Only worth it if this repository is going to carry many more
   large binaries.
3. **Orphan branch `evidence-archive`.** Put the blobs on a branch that `main` does not merge and drop
   them from `main`. Cleanest for browsing, still leaves the blobs in `main`'s history, and every clone
   pays for the orphan branch too unless it is fetched explicitly.
4. **History rewrite (`git filter-repo`).** The only option that actually shrinks clones. It must be a
   coordinated event: announce it, rewrite, force-push, and have everyone re-clone. Nothing else in this
   session depends on it.

## Recommendation and what is deferred

Do **1** in the next maintenance window (it is cheap and reversible), and leave **4** for the day the
repository size becomes a real problem for someone. What is deliberately *not* done in this session:
nothing is moved, deleted, untracked or rewritten, because the audit baseline and every recorded run
hash must stay valid.

Nothing in `docs/evidence/` is affected by any of this — that directory is the record behind the claims
and stays exactly where it is.