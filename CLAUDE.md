# CLAUDE.md — UC-04 AI-Powered Scrum Master Assistant

Project guide for Claude Code. Read this before any work in this repo.

## What this is

A POC of a Microsoft Teams assistant that runs the daily scrum coordination
workflow: stand-up reminders, natural-language status collection, LLM
extraction, tracker writes, blocker escalation, participation tracking and
consolidated sprint summaries.

- **Requirements:** `PRD-UC04-AI-Scrum-Master-Assistant.md` (v1.0) — the contract.
- **Plan:** `docs/POC-Plan.md` — stack, architecture, assumptions, build order.
- **Specs:** `docs/specs/` — what to build, per feature. Code follows specs.
- **Rules:** `docs/rules/` — how to build. Non-negotiable.
- **Setup state:** `docs/SETUP-CHECKLIST.md` — read this before doing setup work.
- **Deadline:** lifted 17 Sep 2026. Build the best POC possible.

## Governing principle

**Build to the PRD as written.** Where the PRD is ambiguous, use the documented
assumption in POC-Plan Section 5 and make it configurable. Do not add scope,
do not drop scope. If something seems missing or wrong, raise it — do not
silently decide.

## Architecture in one paragraph

Code owns everything that must always happen. The LLM owns language
understanding and calls read-only tools when it needs facts. Cloud Scheduler
POSTs `/tick` every 5 minutes; per active team, in its timezone, code runs
whatever job is due. Teams activities arrive at `/api/messages`. Two agents:
Agent 1 (update processor, FR-03/FR-06-detect) and Agent 2 (summary builder,
FR-07). Everything else — scheduling, reminders, follow-ups, tracker writes,
sending the blocker alert, participation, config, distribution — is
deterministic code.

## Hard boundaries

- **Agents get read-only tools only.** No send tool, no write tool, ever. If an
  agent's output needs to cause an action, code performs that action.
- **Agent output is validated before use.** Structured JSON against a schema.
  Invalid output **fails the call**; it never reaches a tracker unchecked, and it
  is never replaced by a program-generated substitute.
- **Update content is never persisted in Firestore.** Firestore holds config,
  conversation references and participation metadata only. Update text lives in
  the team's tracker. This is the Privacy NFR — treat it as a build error.
- **Every scheduled job is idempotent** on `teamId + date + jobType`. `/tick`
  will fire the same job more than once; it must not double-send.

## Stack

TypeScript / Node.js 24 · Microsoft 365 Agents SDK · Adaptive Cards ·
Microsoft Graph · Jira Cloud REST v3 + `azure-devops-node-api` ·
Gemini via a provider adapter in `src/llm/` (`LLM_PROVIDER`: gemini | anthropic |
vertex). Gemini is the approved substitute for Claude and is what ships (A12).
**No fallback:** an LLM failure retries the same model, then fails explicitly.
The program never substitutes its own output for the model's. ·
Cloud Run · Cloud Scheduler · Firestore · Secret Manager · GitHub Actions.

## Layout

```
src/
  index.ts            Express server: /api/messages, /tick, /health
  bot/                activity handlers, install handling, commands
  cards/              Adaptive Card templates
  jobs/               reminder, follow-up, summary, participation
  agents/             updateProcessor.ts, summaryBuilder.ts
  agents/tools/       stories, sprint, updates, participation (read-only)
  trackers/           tracker interface + sharepoint, excel, jira, mock
  pm/                 Jira + Azure DevOps clients
  graph/              Graph client, mail, channel, users
  store/              Firestore repositories
  config/             env + secrets loading
eval/                 labelled sample updates + accuracy scorer
appPackage/           Teams app manifest + icons
docs/                 plan, rules, specs, setup guide, demo script
```

## Workflow

Spec → review → implement → verify. See `docs/rules/process-rules.md`.
Do not write production code for a feature until its spec is marked Approved.

## Demo constraint

Every FR must be demonstrable on the M365 tenant `SyamPadala.onmicrosoft.com`
(Business Basic trial, not the dev-program sandbox). When choosing between two implementations, prefer the one that is
easier to show working. Traceability lives in POC-Plan Section 6.
