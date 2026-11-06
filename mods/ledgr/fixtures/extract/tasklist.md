I finished the requester-notification changes and pushed them to `feature/requester-dm`. The build is green and the unit tests pass.

Before I can deploy, a few things need you:

1. In the hosting dashboard, open the `notifier` service and add the app setting `TRACKER_WEBHOOK_SECRET` (the value is on the tracker's webhook settings page).
2. Sign in to the Slack admin console and approve the custom app install for `requester-bot`, so the workspace policy lets it run.
3. Decide how requesters hear that a ticket closed: **email only**, **Slack DM only**, or **both**. I recommend Slack DM only, since the email path duplicates what the tracker already sends.
4. Send me the ID of the "Platform" user group so I can scope the bot's rollout to it.
5. Review the rollout plan in the PR description and tell me if the order of the three waves reads right to you.

I'm blocked on 1 and 2; the rest can come later. Meanwhile I'll write the README section for the new setting.
