I moved the requester notifier onto the new Slack bot and pushed `feature/slack-bot`; the build is green and all 31 tests pass.

I'm stuck on the last step. The bot's workspace install needs the `chat:write` application permission, and only a Slack workspace admin can grant it. Please grant it in the Slack admin console; I can't finish the install without it.

Everything else is deployed to the staging slot. Before we call this done, please send yourself a test ticket from your machine and check that the DM arrives with a working link.

Both message templates, `compact` and `detailed`, are in the build. I set `detailed` as the default for now, but pick the one you want; switching is a one-line config change.

If you like, I can also add a weekly digest of closed tickets later. And you may want to rotate the old bot's client secret at some point, since nothing uses it anymore.
