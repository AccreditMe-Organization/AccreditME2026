# Plans index

Every file in `backend/Plans/`, with the ticket it plans, whether it is built,
and the pull requests that merged it into `dev`. Sorted by ticket number;
files with no ticket (reviews and references) come last.

Status, as of `dev` at `e9e1db3` (29 Oct 2026):

- **Built:** everything the plan asks for has merged.
- **Partly built:** some of it has merged; the rest is named.
- **Plan only:** nothing from it has merged.
- **Superseded:** built, then replaced by later work, which is named.
- **Reference:** not a build plan (a review, an assessment or a brief).

A plan's own Status line is kept true; the rest of each plan is history and is
not edited. A PR number is given with its squash commit, so both can be
checked: `git show <sha>` on `dev`.

| Plan file | Ticket | Status | Merged PRs |
|---|---|---|---|
| `step-02-organization-structure.md` | ACC-6 | Built | #2 (f38c83f) |
| `step-03-lookup-system.md` | ACC-7 | Built | #3 (d81abf2) |
| `step-04-roles-permissions.md` | ACC-8 | Built | #4 (daf6ad1) |
| `step-06-workflow-engine.md` | ACC-9 | Built | #7 (7996473) |
| `step-07-notification-service.md` | ACC-10 | Built | #8 (dc7f1b8) |
| `step-08-task-management.md` | ACC-11 | Built | #9 (6db01ef) |
| `step-09-user-management.md` | ACC-12 | Built | #10 (f0fd1d7) |
| `step-12-admin-portal.md` | ACC-13 | Built | #11 (ff75e00) |
| `step-15-design-foundation.md` | ACC-15 | Built | #12 (77083bf) |
| `step-16-i18n-rtl-foundation.md` | ACC-19 | Built | #16 (703e213) |
| `step-22-committee-management.md` | ACC-22 | Built | #22 (93259bd) |
| `step-28-resource-scoped-roles.md` | ACC-28 | Built | #26 (10cc87c) |
| `step-29-shared-edit-dialog.md` | ACC-29 | Built | #28 (a471c98) |
| `step-34-unassigned-task-feedback.md` | ACC-34 | Built | #32 (cf4373f) |
| `step-40-org-position-unit-head.md` | ACC-40 | Built | #37 (407047d); verified end to end in #48 (c2e3735, ACC-43) |
| `step-42-overlay-select-migration.md` | ACC-42 | Built | #43 (acd0cc5) |
| `step-46-manager-transfer-escalation-redesign.md` | ACC-46 | Built | #53 (2061305) |
| `step-62-realistic-seed-data.md` | ACC-62 | Built | #62 (96a7630) |
| `step-94-formatting-layer.md` | ACC-94 | Built | #79 (596b9d4) |
| `step-120-4-committees-list.md` | ACC-120 (slice 4) | Built | #186 (7f81220) |
| `step-120-5-permission-matrix.md` | ACC-120 (slice 5) | Superseded | #167 (78b1d59), #177 (e972b57); the grid was replaced by ACC-272's list, #229 (8245880). The save rules still stand. |
| `step-120-5-user-record.md` | ACC-120 (slice 5) | Built | #165 (7c7ae36) |
| `step-120-5b-manage-roles-gaps.md` | ACC-120 (slice 5b) | Built | #180 (227b01a) |
| `step-120-8-ai-credits.md` | ACC-120 (slice 8) | Built | #182 (3151a72) |
| `step-120-9d-login-forgot.md` | ACC-120 (slice 9d) | Built | #150 (08029ab) |
| `step-120-11-organisation.md` | ACC-120 (slice 11) | Built | #196 (6e93a52), #202 (6d315ce), #203 (6a1d728), #206 (954f1a3), #208 (3336c6e), #211 (c1a86ff) |
| `step-130-go-online.md` | ACC-130 (part 1) | Built | #153 (f2b825c) |
| `step-130-go-online-part-2.md` | ACC-130 (part 2) | Built | #159 (95aacc4) |
| `step-133-headship-panel.md` | ACC-133 | Built | #199 (f351e74) |
| `step-139-tenant-from-subdomain.md` | ACC-139 | Built | #149 (1baa0cd) |
| `step-177-file-storage.md` | ACC-177 | Built | #146 (c33231c) |
| `step-181-email-secrets.md` | ACC-181 | Built | #162 (6505a15) |
| `step-184-spec-direction-leak.md` | ACC-184 | Built | #148 (562b019) |
| `step-185-sharepoint-storage.md` | ACC-185 | Built | #151 (73c15a1) |
| `step-186-148-secure-cookies-base-url.md` | ACC-186, ACC-148 | Built | #152 (b9d76d3) |
| `step-189-file-viewer.md` | ACC-189 | Built | #157 (048c887) |
| `step-190-stage-task-definitions.md` | ACC-190 | Built | #154 (5f775d3), #155 (0d76047) |
| `step-193-ai-file-summary.md` | ACC-193 | Built | #168 (2ac8174) |
| `step-194-ai-foundation.md` | ACC-194 | Built | #163 (4aa860c) |
| `step-197-task-drafting.md` | ACC-197 | Built | #172 (74bab36) |
| `step-198-morning-briefing.md` | ACC-198 | Built | #164 (df16243) |
| `step-199-workload-hint.md` | ACC-199 | Built | #175 (3df989e), #176 (44a68dd) |
| `step-ACC-203-signout-ends-session.md` | ACC-203 | Built | #156 (ed8e885) |
| `step-ACC-204-session-bound-to-address.md` | ACC-204 | Built | #158 (0beff57) |
| `step-208-stage-tasks-screen.md` | ACC-208 | Built | #160 (361b84c) |
| `step-213-website-scaffold.md` | ACC-213 | Built | #161 (e4cc4d8) |
| `step-220-briefing-dates.md` | ACC-220 | Built | #166 (d4d9dec) |
| `step-222-transfer-only-placement.md` | ACC-222 | Built | #169 (8e553a5) |
| `step-223-stale-chunks.md` | ACC-223 | Built | #171 (2ea914e) |
| `step-224-arabic-pdf-order.md` | ACC-224 | Built | #170 (7948f37) |
| `step-226-framework-null.md` | ACC-226 | Built | #173 (cd5c381), #174 (e9c7b3b) |
| `step-228-record-tasks-panel.md` | ACC-228, ACC-229, ACC-230 | Built | #178 (e9aaed7), #179 (ff3266f), #181 (4638b5f) |
| `step-231-task-files-access.md` | ACC-231 | Built | #185 (c81c25e) |
| `step-233-committee-reference-checks.md` | ACC-233 | Built | #183 (23a5649) |
| `step-238-committee-changes.md` | ACC-238, ACC-239, ACC-240, ACC-241 | Built | #191 (08bd1bf), #198 (8fa444e), #205 (45e8f56), #209 (91828ea); ACC-241 in #215 (341545f) |
| `step-240-change-request-screens.md` | ACC-240 | Built | #205 (45e8f56), #209 (91828ea) |
| `step-244-task-permissions.md` | ACC-244 | Built | #200 (8dae79e), #201 (3b36e85), #204 (86c4296) |
| `step-255-workflow-stage-rules.md` | ACC-255 | Built | #212 (f617304), #215 (341545f), #219 (3ddbe58), #223 (45c6bd6), #225 (70af292), #227 (d8a7af4); G2, the History card, moved to ACC-267 |
| `step-258-lock-workflows-manage.md` | ACC-258 | Built | #213 (bab1c02) |
| `step-260-storage-settings.md` | ACC-260 | Built | #214 (e658b0a), #218 (780d9b3), #222 (8acda92), #226 (dbd0ce2), #228 (75d9e0d) |
| `step-271-stage-owns-who.md` | ACC-271 | Partly built | #230 (a580a00, PR 1), #231 (5a4d2d9, PR 2). Not started: PRs 3 to 6. This plan's own Status line is lane B's to keep. |
| `website-plan-2026-10-10.md` | ACC-213 and lane split | Partly built | #161 (e4cc4d8), the scaffold on its preview address; the cut-over of the apex and `www` is not started |
| `module-designs.md` | — | Reference | The business rules per module. Task and Committee match what is built; the other modules are design intent. |
| `audit-backend-frontend-coverage.md` | — | Plan only | The coverage audit has not been run |
| `accreditme-handover.md` | — | Reference | Handover brief |
| `document-management-engine-fit.md` | — | Reference | ACC-64's fit review |
| `ux-review-2026-09-10.md` | — | Reference | ACC-71's UX review |
| `workflow-configurability-assessment.md` | — | Reference | Assessment |
| `workflow-task-model-review.md` | — | Reference | ACC-64's structural review |
