import type { Workflow } from "./workflow-types.js";

export const realAutomations: Workflow[] = [
  {
    name: "process_invoice_email",
    trigger: { type: "email", filter: "subject:Invoice has:attachment" },
    actions: [
      {
        type: "agent.document_parser",
        input: { file: "${event.payload.attachments.0}" },
      },
      {
        type: "agent.analysis_agent",
        input: { data: "${document_parser_result.extracted}" },
      },
      {
        type: "postgres.query",
        sql: "INSERT INTO invoices (vendor, amount, currency, due_date) VALUES ($1, $2, $3, $4)",
        params: [
          "${document_parser_result.extracted.vendor}",
          "${document_parser_result.extracted.amount}",
          "${document_parser_result.extracted.currency}",
          "2026-04-01",
        ],
      },
      {
        type: "agent.notification_agent",
        input: {
          to: "#finance",
          subject: "New Invoice",
          body: "Invoice from ${document_parser_result.extracted.vendor} processed.",
          channel: "slack",
        },
      },
    ],
  },
  {
    name: "github_pr_check",
    trigger: { type: "webhook", filter: "event:pull_request action:opened" },
    actions: [
      {
        type: "github.list_prs",
        repo: "${repo_name}",
      },
      {
        type: "terminal.run",
        command: "npm test",
      },
      {
        type: "github.create_issue", // Post comment/review
        repo: "${repo_name}",
        title: "Automated Review for PR #${pr_number}",
        body: "Tests passed! Ready for human review.",
      },
    ],
  },
  {
    name: "morning_briefing",
    trigger: { type: "cron", cron: "0 8 * * 1-5" }, // Mon-Fri 8am
    actions: [
      { type: "browser.search", query: "tech news today" },
      { type: "calendar.list_events", timeMin: "now", timeMax: "end_of_day" },
      {
        type: "llm.summarize", // Hypothetical LLM tool
        context:
          "Here are the news: ${browser.search.output}. Here is the calendar: ${calendar.list_events.output}.",
      },
      {
        type: "terminal.run",
        command: "say 'Good morning. Your briefing is ready.'", // TTS via CLI
      },
    ],
  },
  {
    name: "data_collection",
    trigger: { type: "manual" },
    actions: [
      {
        type: "parallel",
        actions: [
          { type: "browser.search", query: "market news today" },
          { type: "finance.get_market_data", symbols: "AAPL,MSFT,GOOG" },
        ],
      },
      {
        type: "agent.analysis_agent",
        input: {
          news: "${browser.search.output}",
          market: "${finance.get_market_data.output}",
        },
      },
      {
        type: "agent.notification_agent",
        input: { channel: "slack", to: "#research", subject: "Daily Data", body: "Summary ready." },
      },
    ],
  },
  {
    name: "game_observe",
    trigger: { type: "manual" },
    actions: [
      { type: "screen.capture", format: "png" },
      { type: "screen.detect_objects", imageBase64: "${base64}", previousImageBase64: "${previousImageBase64}" },
      { type: "game.get_reward", diffScore: "${diffScore}" },
    ],
  },
];
