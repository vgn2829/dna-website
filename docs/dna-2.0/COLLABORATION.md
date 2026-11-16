# DNA 2.0 V1 — Project collaboration (Milestone F)

| | |
|---|---|
| **Status** | Implemented on `release/dna-2.0-v1` |
| **Scope** | Dependable *project-level* collaboration on Showcase projects. **Not** real-time multiplayer editing (out of scope for V1). |
| **Code** | `backend/src/routes/showcaseCollab.ts`, `backend/src/lib/showcaseAccess.ts`, `backend/src/db/showcaseSchema.ts`; UI in `src/app/components/showcase/{Collaboration,SharedProjects}.tsx` and `src/app/pages/ShowcaseEditorPage.tsx` |
| **Tests** | `backend/tests/showcase-collab-{invitations,permissions,attribution}.test.ts`, `showcaseAccess.test.ts`; `src/app/**/Collaboration*.test.tsx`, `SharedProjects.test.tsx`, `ShowcaseEditorPage.roles.test.tsx` |

## 1. Architectural decisions

1. **The collaborative unit is the Showcase project** (`showcase_projects`, Milestone D). The private workspace `projects` table (V2.2) is unrelated and untouched. The V1 journey ends in a published Showcase page, so that is where people collaborate.
2. **Access and attribution are two separate consents, in two tables.** `showcase_collaborators` says who may *work on* a project; `showcase_credits` (unchanged, Milestone D) says who is *named publicly*. Accepting an invitation never names anyone. A person can be an editor with no credit, or credited with no access.
3. **Ownership has exactly one source of truth:** `showcase_projects.owner_roll`. The collaborators table has no `owner` role and the API cannot create or transfer one — "cannot transfer ownership" is true by construction, not by a check.
4. **No second identity model.** Invitees are existing `student_sessions` rows (roster-gated at registration) found by roll number or by the public username from `designer_profiles` (#84). Display names come from the profile, else the account name.
5. **One permission matrix, one resolver** (`lib/showcaseAccess.ts`). Routes ask `can(access, permission)`; the server sends the viewer's resolved permission list to the client, which only renders it. The frontend never re-derives a permission from a role name.

## 2. Roles and permissions

| Permission | Owner | Editor | Viewer |
|---|:-:|:-:|:-:|
| Read project, collaborator names, activity, discussion | ✔ | ✔ | ✔ |
| Post / delete own comments | ✔ | ✔ | ✔ |
| Edit title, summary, description, category, tags, links, disciplines | ✔ | ✔ | – |
| Add *own* Asset Library images; caption, reorder, set cover | ✔ | ✔ | – |
| Remove images (any / only ones they added) | any | own | – |
| Edit moodboard links & Gallery artwork references | ✔ | – | – |
| Invite, withdraw, remove collaborators; change roles | ✔ | – | – |
| Propose / change / remove other people's credits; owner's credit | ✔ | – | – |
| Submit, withdraw submission, archive, reopen | ✔ | – | – |
| Delete project | ✔ | – | – |
| Delete other people's comments | ✔ | – | – |

* **Content is frozen for every role** while a project is `submitted`, `approved` or `published` (the same rule as before collaboration: an edit cannot slip past review). The owner withdraws the submission or archives to edit.
* **Publishing stays with the club.** Owners *submit*; an admin approves and publishes (Milestone D moderation). No collaborator role can publish.
* A non-member (stranger, pending invitee, declined, withdrawn, removed) gets **404** on every project route — existence is not revealed. A member lacking a permission gets **403**.

## 3. Invitations

States: `pending → accepted | declined | withdrawn`, and `accepted → removed` (owner removal *or* the person leaving).

* Only the **owner** invites, only while the project is editable, and only with an **email-OTP-verified session** (`requireVerifiedStudent`; legacy 90-day and bypass tokens get 403). Accepting and role changes need the same; *declining and leaving are always allowed*.
* Target is `{ handle }` (public, active profiles only) **or** `{ roll }`. Unknown, self, blocked, private-profile, and recently-declined all return the **same** `404 "That student can’t be invited to this project"` — the endpoint is not a roster oracle. (The pre-existing credit-invite endpoint was aligned to the same answer.)
* Duplicates / conflicting invitations → `409`; concurrent duplicates are serialised with a project row lock (6 parallel invites → exactly one succeeds; tested).
* Limits: 10 active (pending + accepted) per project; **30 invitations per person per 24 h** (counted in the database, so it survives restarts and multiple instances); 10/min per student; 7-day cooldown before re-inviting someone who declined.
* **Decline & block:** an invitee can refuse all future invitations from that owner (also honoured by the credit-invite path) and can undo it.
* Invitations appear under *My projects → Invitations to collaborate*. **There is no push/e-mail notification in V1** (the notification service is board/workspace-shaped) — see Known limitations.

## 4. Contributor attribution (consent)

* An invitation may **propose** a credit (`role_label`, `contribution`) using the existing `showcase_credits` flow. The invitee decides separately: *Accept* (access only) or *Accept & be credited…* (access + their chosen display name).
* A pending credit **blocks submission** and publishing (existing rule) — so a proposal never lingers: it is deleted when its invitation is withdrawn, declined, or the person is removed / leaves.
* **Accepted credits are preserved** when access is removed or a role changes (role changes touch only `access_role`). Changing a credit's *label* still re-asks for consent (existing Milestone D rule). A person withdraws their credit at any time (`/api/showcase/invitations/:id/decline`) and it leaves the public page **immediately** (tested).
* Public responses carry display names only; roll numbers are visible to the **owner** (who typed them) and to each person for their own row, never to other collaborators or the public.

## 5. Images added by collaborators

* An editor can only add images from **their own** Asset Library (same rule as the owner's). Each work records `added_by_roll` (NULL = owner / pre-collaboration).
* On publish, each public copy is made from the source asset **only if its contributor still owns it**; a mismatch aborts publishing with a clear 409.
* **Removal or leaving takes the person's images with them:** their rows are deleted, any public copies are deleted from storage, the cover is re-chosen, and a project left with **no** images while in review/published is returned to `draft` with a `system` event. Their own Asset Library is never touched.
* Editors cannot remove images other people added; the owner can remove any.

## 6. Activity and discussion

* **Activity** (`showcase_activity`): invitations, joins, leaves, role changes, edits (field names only), image changes, status changes, comments. Detail keys are allow-listed on read, so a future writer cannot leak a roll or e-mail. Actors are shown by name.
* **Discussion** (`showcase_comments`): visible to the owner and accepted collaborators only (never on the public page, never in public APIs). 1–2000 characters, stored verbatim, **rendered as text only**. Authors delete their own; the owner can delete any. Comment text never enters the activity feed.

## 7. API (all under `/api/showcase/collab`, student auth)

| Method & path | Who | Notes |
|---|---|---|
| `GET /invitations` | invitee | pending only; owner shown by name |
| `GET /shared` | collaborator | accepted, non-archived projects |
| `POST /projects/:id/collaborators` | owner, verified | body `{handle|roll, access_role, role_label?, contribution?}` |
| `PATCH /projects/:id/collaborators/:cid` | owner, verified | `{access_role: editor|viewer}`; `owner` is rejected |
| `DELETE /projects/:id/collaborators/:cid` | owner, verified | pending → `withdrawn`; accepted → `removed` |
| `POST /invitations/:id/accept` | invitee, verified | optional `{display_name}` also accepts a proposed credit |
| `POST /invitations/:id/decline` | invitee | optional `{block: true}` |
| `POST /projects/:id/leave` | collaborator | owner cannot leave |
| `GET /projects/:id/activity?before=` | member | 30/page |
| `GET|POST /projects/:id/comments`, `DELETE …/:cid` | member | |
| `GET /blocks`, `DELETE /blocks/:id` | blocker | |

Existing endpoints made role-aware: `GET /api/showcase/mine/:id` (any member; rolls/moodboard links hidden from non-owners), `PATCH /mine/:id` (owner/editor; owner-credit fields owner-only), `PUT /mine/:id/works` (owner/editor; per-image ownership rules above). Everything else under `/mine/:id` stays owner-only.

## 8. Data model

```
showcase_collaborators(id, project_id→showcase_projects ON DELETE CASCADE, roll, access_role editor|viewer,
                       status pending|accepted|declined|withdrawn|removed, invited_by, invited_at, responded_at, updated_at,
                       UNIQUE(project_id, roll))
showcase_assets.added_by_roll TEXT NULL            -- additive column
showcase_collab_blocks(id, blocker_roll, blocked_roll, UNIQUE pair)
showcase_activity(id BIGSERIAL, project_id→… CASCADE, actor_roll, kind, detail JSONB)
showcase_comments(id, project_id→… CASCADE, author_roll, body 1..2000, deleted_at)
```
All additive and idempotent (`CREATE TABLE IF NOT EXISTS`, `ADD COLUMN IF NOT EXISTS`); RLS is enabled (no policies) on all of them — see the runbook.

## 9. Known limitations (V1)

* No real-time co-editing; saves are last-write-wins per request and the editor reloads on open. Two editors saving the same field at once → the later save wins.
* No e-mail / bell notification for invitations or comments; people see them in *My projects* and the project page.
* Moodboard references and Gallery-artwork links are owner-managed (a deliberate, safe subset: those objects have their own, separate access rules).
* Ownership transfer is not offered.
* An invited student must already have a DnA account (roster-gated registration).
