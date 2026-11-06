I wrote the migration that adds the `requester_dm` column and the API change that reads it. Both are on `feature/requester-dm`, and the tests pass against the local database.

The migration hasn't been applied to production yet, and the API change will fail there until it is. If you're able to share the read-write connection string for `prod-sql`, I'd be happy to apply it and run the smoke test for you. No rush!

Want me to also add an index on `requester_dm`? It isn't needed at the current table size.
