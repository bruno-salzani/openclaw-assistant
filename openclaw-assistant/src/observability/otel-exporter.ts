export class OTelHttpJsonExporter {
  private url: string;

  constructor(url: string) {
    this.url = url;
  }

  export(span: {
    id: string;
    parentId?: string;
    name: string;
    startTime: number;
    endTime: number;
    attributes: Record<string, unknown>;
  }) {
    const body = {
      resourceSpans: [
        {
          scopeSpans: [
            {
              spans: [
                {
                  traceId: span.id,
                  spanId: span.id,
                  parentSpanId: span.parentId,
                  name: span.name,
                  startTimeUnixNano: `${span.startTime}000000`,
                  endTimeUnixNano: `${span.endTime}000000`,
                  attributes: Object.entries(span.attributes).map(([k, v]) => ({
                    key: k,
                    value: { stringValue: String(v) },
                  })),
                },
              ],
            },
          ],
        },
      ],
    };
    try {
      fetch(this.url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      }).catch(() => undefined);
    } catch {}
  }
}
