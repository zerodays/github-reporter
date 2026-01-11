# GitHub Reporter - Idea

## Purpose
A self-hostable microservice that generates daily, LLM-written summaries of GitHub activity for a user or org. The output is meant to be easy to consume by other apps (posting to social media, dashboards, or a personal ledger).

## Why it matters
- Automated visibility for what you worked on (hype, engagement, and personal history).
- Organization-ready with private repo support and controlled hosting.
- Outputs are stored as artifacts so any downstream system can read them.

## Core goals
- Pull recent activity from selected repositories (commits, PRs, issues later).
- Produce reports in multiple formats (markdown, JSON, or schema-based JSON).
- Store outputs in a bucket you control.
- Optionally call a webhook when artifacts are ready.
- Stay self-hostable and environment-variable driven.

## Design principles
- Stateless execution: pull -> generate -> store -> notify.
- Minimal required setup: a token, a bucket, and a prompt.
- Flexible prompts: users can tune tone and format.
- Safe defaults: rate-limit conscious and skip huge or generated files.

## High-level approach
1. Fetch activity from GitHub for a time window.
2. Normalize and summarize the raw activity into a compact input.
3. Generate report text via LLM using a prompt template (optionally enforce schema).
4. Write the output to object storage.
5. Send a webhook callback with metadata.

## Future directions
- Per-developer reports for orgs.
- Repo file context (README, llm.txt, selected code excerpts).
- Backfill and historical reports.
- Observability (logs, metrics, retries).
