import type { Workflow } from "./workflow-types.js";

export const workflowExamples: Workflow[] = [
  {
    name: "invoice_ingestion",
    trigger: { type: "new_email", filter: "invoice" },
    actions: [
      { type: "extract_data", schema: { total: "number", vendor: "string", due_date: "string" } },
      { type: "db_insert", table: "invoices" },
      { type: "notify", channel: "slack", to: "#finance" },
    ],
  },
  {
    name: "pr_review",
    trigger: { type: "github.pr_opened" },
    actions: [
      { type: "run_tests", command: "pnpm test" },
      { type: "summarize_pr" },
      { type: "notify", channel: "slack", to: "#eng" },
    ],
  },
  {
    name: "daily_brief",
    trigger: { type: "cron", cron: "0 8 * * *" },
    actions: [
      { type: "fetch_calendar" },
      { type: "fetch_emails" },
      { type: "summarize" },
      { type: "notify", channel: "slack", to: "@me" },
    ],
  },
];
