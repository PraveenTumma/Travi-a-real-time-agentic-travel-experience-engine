---
description: Hand a task to a teammate (or the team) through team-sync
argument-hint: <sai|shiv|praveen|any> <what needs doing>
---
Delegate this through team-sync: $ARGUMENTS

1. Work out the assignee (sai, shiv, praveen, or `any`) and a one-line, action-first title. If either is unclear, ask the user.
2. Write details a teammate's Claude can act on without this conversation: the goal, the files involved (check them first), acceptance criteria, and any API contract that the other side depends on.
3. Run: `node .claude/team/team.mjs task add "<title>" --to <assignee> --priority <P0|P1|P2> --details "<details>"`
4. Tell the user the task id. The assignee's Claude sees it on their next prompt.
