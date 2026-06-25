## Goal

Bring the SEVS app into full compliance with the pasted SRS for voting, results, and audit. The database already has the needed tables/columns (`ballots`, `election_keys`, `ballot_receipts.receipt_token`, `audit_log.details`, `elections.public_key/results_published/tally/tallied_at`) and an atomic `cast_ballot_tx` function — most work is wiring these together plus new endpoints and UI.

Default decision (adjustable): for tallying, the admin enters the one-time passphrase shown at election creation; the server uses it to decrypt the stored private key, then decrypts ballots. This matches "private key provided by the administrator."

## Phase 1 — Encrypted, signed, atomic ballot casting

Rewrite `castBallot` in `src/lib/sevs.functions.ts`:
- Keep all current validation (active account, open window, eligibility, one-vote, valid positions/candidates/seat limits).
- Generate an AES-256-GCM session key, encrypt the ballot JSON (selections) → `ciphertext` + `iv`.
- Encrypt the AES key with the election RSA public key (RSA-OAEP) → `encrypted_key` (hybrid encryption).
- Compute `ballot_hash = SHA-256(ciphertext)`; sign the hash with an RSA-SHA256 signing key → `signature`.
- Generate an opaque `receipt_token` (random, e.g. base64url).
- Call `cast_ballot_tx` so the `ballots` insert, `election_eligibility` update (`has_voted=true`, `voted_at=now()`), and `ballot_receipts` insert happen in one transaction.
- Stop writing plaintext `votes` rows on cast (tally now comes from decryption at close).
- Audit `BALLOT_CAST` with a hash-only `details` string (no content).

Return the opaque receipt token to the client.

### Signing-key handling (technical)
The SRS asks for an RSA-SHA256 signature over the ballot hash. Add a per-election signing keypair generated at election creation (extend `generateElectionKeys`): store the signing public key for verification and the signing private key wrapped like the encryption key. The server signs at cast time using a server-held signing key derived from a generated secret (so casting needs no admin passphrase). Verification of signatures is exposed to admins.

## Phase 2 — 20-minute ballot session timeout

- Record ballot-delivery time when `getElectionDetail` serves a ballot (issue a short-lived signed token / timestamp to the client).
- Client (`vote.$electionId.tsx`): start a 20-minute countdown on load; show remaining time; on expiry, block submit and redirect to `/login` requiring re-auth.
- Server `castBallot`: reject submissions whose delivery timestamp is older than 20 minutes with a clear "session expired" error.

## Phase 3 — Results gating, decrypt + tally on close

- Add an admin "Close & tally" action: admin supplies the election passphrase; server decrypts the private key, decrypts every ballot, tallies per position/candidate, stores aggregate in `elections.tally` + `tallied_at`, sets `results_published`. Audit `ELECTION_CLOSED` and `TALLY_COMPUTED`.
- `getElectionResults`: refuse unless status is CLOSED or `results_published` — return a sealed response during OPEN (prevents any partial count). Source counts from stored `tally`.
- Results page (`results.$electionId.tsx`): show total eligible voters, total ballots cast, participation rate (%), and per-candidate counts + percentages per position.

## Phase 4 — SSE live results

- Add a server route `src/routes/api/public/results-stream.$electionId.ts` that streams tally data every 5 seconds via Server-Sent Events, only while `results_published` is true (otherwise 403). No PII, aggregates only.
- Results page subscribes via `EventSource` during the published phase and updates live.

## Phase 5 — Results export (PDF + CSV)

- Admin-only server functions returning a CSV string and a PDF (counts/percentages per candidate per position, eligible/cast/participation header).
- Buttons on the results/admin view to download both. Audit `RESULTS_EXPORTED`.

## Phase 6 — Full audit coverage + integrity + signed PDF

- Extend `appendAudit` to always set the `details` string and support actor `'SYSTEM'`.
- Add missing audit events: login success/failure/account-locked, TOTP setup/reset, election opened/closed/suspended/published, candidate removed (fix to include election id), eligibility modified (already), tally computed, audit accessed, audit exported.
- Add admin endpoint `verifyAuditChain` that recomputes the entire SHA-256 chain and reports the first broken link (or "valid"). Surface a "Verify integrity" button on `/audit`.
- Add admin signed-PDF export of the full or filtered audit log: render entries to PDF and attach an RSA signature (with a published verification key) so recipients can verify authenticity. Audit the export itself.

## Technical notes

- All crypto runs server-side via WebCrypto (Worker-safe), consistent with existing `generateElectionKeys`.
- PDF generation must use a Worker-compatible approach (no native deps); generate via a lightweight pure-JS/`pdf-lib`-style library or build PDFs server-side and return bytes.
- SSE uses a TanStack server route under `/api/public/*` with its own auth/justification (aggregate, published-only).
- A migration will add: per-election signing public key column, optional `voted_at` already present, and any GRANT/policy tweaks; the existing append-only trigger stays.

## Out of scope / assumptions

- Account lockout policy and TOTP are assumed to already exist at the auth layer; this work only adds their audit entries.
- "Suspend" election is modeled as an admin status flag if not already present.
