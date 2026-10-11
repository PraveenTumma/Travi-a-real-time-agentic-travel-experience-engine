---
description: Wrap up the current piece of work. Verify, commit, push, and tell the team
---
Wrap up the current work and send it to the team. $ARGUMENTS

1. Verify what you touched: `npm run build` in `frontend/` for frontend changes, and `python -m pytest` for backend changes. If something fails, stop and tell the user.
2. Show the user the diff summary and propose a commit message. Commit only after they agree.
3. `git pull --rebase --autostash`, resolve anything that comes up with the user, then `git push`. Pushing to main deploys (Vercel and Render), so only push a green build.
4. Update team-sync: `node .claude/team/team.mjs task done <T-id> --note "<what changed>"` for finished tasks. For anything teammates must know (a changed API shape, new env var, renamed file), run `node .claude/team/team.mjs log "<note>"`.
5. Run `node .claude/team/team.mjs status "<next thing>"` if the user is moving on, or `node .claude/team/team.mjs idle` if they're stopping.
