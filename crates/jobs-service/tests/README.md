# Job library checks

The API suite covers private company bookmarks and proposal drafts, concurrent
save/publication races, discovery filters and pagination, actual company
participation, public job reputation, and certification filters.

Run against a **migrated, isolated local database** whose name contains `test`:

```sh
cargo test --locked -p connect-jobs
cargo build --locked -p connect-jobs
DATABASE_URL=postgres://user:password@127.0.0.1:5438/connect_test \
  node crates/jobs-service/tests/run-job-library-api.mjs
```

The runner starts its own Rust service on an unused local port, uses temporary
uploads, and stops and removes only those resources when finished. The suite
creates and deletes its own database records. The runner is included in the
`provider-matching` GitHub Actions job after migrations and the Rust build.

To reuse an already running isolated service, run `job-library-api.mjs` with
`DATABASE_URL` and `JOBS_TEST_URL` instead.

## Colabb browser checks

`proposal-draft-ui.mjs` exercises partial saving, resume, company privacy,
concurrent-edit recovery, attachment warnings and successful publication.
`job-proof-ui.mjs` exercises proof upload, full-screen preview, changes,
resubmission and hirer approval; it also checks that other companies have no
submission or approval controls.

Both require an existing isolated local Colabb API/web/Rust stack and a protected
JSON fixture file with `base`, `password`, and `accounts.hirer.email`,
`accounts.provider.email`, `accounts.other.email`. Use independently verified
company administrators. Only localhost/127.0.0.1 URLs are accepted. The browser
checks create labelled QA jobs in that test database; they do not modify real
accounts or production jobs.

```sh
COLABB_UI_FIXTURES=/private/path/to/local-fixtures.json \
  node crates/jobs-service/tests/proposal-draft-ui.mjs
COLABB_UI_FIXTURES=/private/path/to/local-fixtures.json \
  node crates/jobs-service/tests/job-proof-ui.mjs
```

Set `CHROME_PATH` if using an installed Chrome executable instead of Playwright's
bundled Chromium. Keep fixture credentials out of Git.
