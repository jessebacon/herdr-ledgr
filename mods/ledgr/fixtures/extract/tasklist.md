I finished the requester-notification changes and pushed them to `feature/requester-dm`. The build is green and the unit tests pass.

Before I can deploy, a few things need you:

1. In the Azure portal, open the `work-notifier` Function App and add the app setting `LINEAR_WEBHOOK_SECRET` (the value is on the Linear webhook settings page).
2. Sign in to the Teams Admin Center and approve the custom app upload for `work-requester-bot`, so the preinstall policy can run.
3. Decide how requesters hear that a ticket closed: **email only**, **Teams DM only**, or **both**. I recommend Teams DM only, since the email path duplicates what Linear already sends.
4. Send me the object ID of the "Sys Dev" Entra group so I can scope the bot's preinstall to it.
5. Review the rollout plan in the PR description and tell me if the order of the three waves reads right to you.

I'm blocked on 1 and 2; the rest can come later. Meanwhile I'll write the README section for the new setting.
