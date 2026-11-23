I went through the pipeline project and drafted the changes for the release pipeline. Nothing is applied yet.

What I'll change, once you confirm:

| # | Change | Where |
|---|---|---|
| 1 | Rename the `Build-CI` pipeline to `ledgr-ci` | Pipelines |
| 2 | Require 2 reviewers on pull requests into `main` | Repos > Policies |
| 3 | Delete the stale `release/5.4` branch | Repos > Branches |
| 4 | Move the `DEPLOY_TOKEN` secret into the `prod` variable group | Library |
| 5 | Turn off the nightly build on `develop` | Pipelines > Triggers |

Row 3 can't be undone from here: once the branch is gone, its two unmerged commits go with it. The other four I can revert in a minute if you change your mind.
