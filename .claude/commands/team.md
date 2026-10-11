---
description: Sync with the team. Pull teammates' work, see who is doing what, and pick up your tasks
---
Run `node .claude/team/team.mjs sync` and then `node .claude/team/team.mjs brief` from the repo root.

Then give the user a short report:
1. What teammates are doing right now, and any files they're editing that overlap with ours.
2. Tasks assigned to us, and unassigned tasks worth claiming.
3. Anything pulled from main, or anything blocking a pull (uncommitted work, unpushed commits).
4. One recommended next step.

If the user wants to take a task, run `node .claude/team/team.mjs task claim <T-id>` and then `node .claude/team/team.mjs status "<what you'll do>" --files <paths you expect to touch>`.

$ARGUMENTS
