# M6 operations / isolated local PostgreSQL rehearsal

Date: 27 October 2026. This card implements and executes a local recovery rehearsal. It does not declare M6 or production release complete. Owned changes: `scripts/operations-rehearsal.ts`, `tests/operations-rehearsal.test.ts`, `docs/production/operations.md`, this report and sanitized `docs/production/evidence/operations-rehearsal.json`. Runtime, migrations, manifests, configuration, providers and gates were unchanged.

## Executed behavior and results

The script reads the approved private PostgreSQL connection/key in process without printing them. The existing loopback server is PostgreSQL 18.6; portable `pg_dump`/`pg_restore` are 18.6. Download provenance records the vendor archive SHA-256, copied into sanitized evidence. The script verifies host, port and current administrator database before creating anything. Only three fresh `klnk_qa_ops_<UUID>` names allocated in that invocation can be created/dropped. Administrator queries use PostgreSQL catalogs/server identity; no shared application tables, schemas, roles, OS services or cluster data files are changed.

A custom-format logical dump of fictional fixtures is restored with single-transaction/error-stop behavior into an empty offline quarantine. Actual assertions establish that the dump restores a still-valid old bearer session, worker lease, Live controller lease and personal content deleted after the dump. Quarantine never has a running API/worker and never receives traffic.

After the source account's fictional deletion, the operator journal CLI exports its tombstone since the original dump start, using a read-only transaction. The same CLI refuses to overwrite the file. The journal is separate from the earlier snapshot. An encrypted application backup exported from quarantine is restored into a third empty migrated database with that journal. Seven restoration assertions establish encrypted content, retained allowed content, zero authentication sessions/old-token rejection, deleted-owner tombstone/content suppression, worker/controller authority removal with provider identity preserved, and queued Google cleanup retained while deleted-owner ordinary work is omitted. No cleanup job executes and no provider is contacted.

Current migrations 001–006 and their SHA-256 checksums are recorded. The current candidate reopens the same ledger, refuses an injected unknown-future ledger entry and refuses checksum drift. The test then restores only its own fictional ledger modifications and verifies the real migration artifacts remain unchanged. This is a current-artifact compatibility/refusal exercise, not a rollback to an actual earlier candidate, a new repair migration or a traffic switch.

All **17 assertions pass**. Teardown closes connections, rechecks the guarded endpoint, drops only the three allocated databases, verifies **zero remain**, and deletes the resolved temporary archive/journal directory. No fixture identities, data, token, key, connection URL or raw utility errors enter [the sanitized evidence](../evidence/operations-rehearsal.json). Its hashes are integrity identifiers; it retains no dump or deletion journal. Utility subprocesses run hidden with a small environment allowlist and private credential environment variables. A failed command prints only a fixed stage label; operators must investigate privately rather than exposing raw database diagnostics.

## Checks actually run

| Command | Actual result |
| --- | --- |
| `npx tsx scripts/operations-rehearsal.ts rehearse` | Final run: 17 assertions passed, PostgreSQL/CLI 18.6, 3 created/0 remaining databases, no provider contact |
| `npx vitest run tests/operations-rehearsal.test.ts` | 3 passed: adversarial name/endpoint/options guards and real embedded tombstone journal filtering/invalid timestamp rejection |
| `npm run typecheck` | Server/shared root and mobile passed |
| Local Markdown/evidence check | 5 local links resolve; all 17 evidence assertions true and cleanup reports zero remaining databases |

Initial invocation stopped safely before database creation because PostgreSQL's inet text representation includes `/32`; the server identity check was corrected to `host(inet_server_addr())`. Subsequent runs passed and cleaned all allocated databases. The final rehearsal was rerun after adding the actual operator CLI/overwrite checks. Tests are local and fictional; the journal regression checks no email/password data leaks and no injected timestamp executes SQL.

The reusable operator CLI requires private `KLNK_JOURNAL_DATABASE_URL`, an explicit canonical UTC `--since` time and a new protected `--file`. It performs a read-only transaction and does not load application/provider configuration. The runbook explains original-snapshot timing, Windows ACL verification, independent storage, tombstone coverage and the limitation of one-time exports. No scheduled journal replication, backup retention, key rotation or hosting infrastructure was introduced.

## Remaining release gates

The approved local fixture uses an administrative role; production least-privilege roles, protected credentials/password files, dump/journal ACLs and backup/key lifecycle remain environment work. This small fixture's elapsed time is not an RTO/RPO result. No physical base backup, WAL/PITR, remote failover, crash mid-restore, large-data recovery or continuous deletion-journal durability was tested.

No deployable older artifact was supplied, so actual candidate rollback, staging traffic drain/switch, compatibility with a prior running worker, rollback after remote effects and release operator drill remain open. Root owns final candidate/source manifests. Host/service monitoring, alert delivery and escalation, worker liveness alarms, provider budget alerts, real staging readiness, native signing/distribution and real iPhone verification also remain open. No provider key, microphone, external account or billable infrastructure was used by this card.

The runbook cites official PostgreSQL 18 utility/environment documentation and applies the installed PostgreSQL connection/privilege guidance. Those references inform the procedure; this local rehearsal does not certify an external deployment.
