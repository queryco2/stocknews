import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
test("real stdio MCP handshake, schemas, publication and query", async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "stocknews-mcp-"));
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [
      path.resolve("node_modules/tsx/dist/cli.mjs"),
      path.resolve("server/mcp.ts"),
    ],
    env: { ...process.env, STOCKNEWS_DATA_DIR: dir } as Record<string, string>,
    stderr: "pipe",
  });
  const client = new Client({ name: "integration-test", version: "1" });
  try {
    await client.connect(transport);
    const listed = await client.listTools();
    assert.equal(listed.tools.length, 9);
    const schema = await client.callTool({
      name: "get_ingestion_schema",
      arguments: {},
    });
    assert.ok(!schema.isError);
    const decode = (r: any) => JSON.parse(r.content[0].text);
    const run = decode(
      await client.callTool({
        name: "begin_ingestion",
        arguments: {
          batch_id: "integration",
          date: "2026-09-30",
          session: "morning",
          market: "CN_A",
        },
      }),
    );
    const result = await client.callTool({
      name: "submit_morning_report",
      arguments: {
        run_id: run.run_id,
        report: {
          date: "2026-09-30",
          session: "morning",
          market: "CN_A",
          window_start: "2026-09-29T08:00:00+08:00",
          window_end: "2026-09-30T08:00:00+08:00",
          data_as_of: "2026-09-30T08:00:00+08:00",
          coverage: "测试样本",
          sectors: [
            { key: "chip", name: "半导体", rank: 1, reason: "测试", news: [] },
          ],
        },
      },
    });
    assert.ok(!result.isError, JSON.stringify(result));
    const done = await client.callTool({
      name: "finish_ingestion",
      arguments: { run_id: run.run_id },
    });
    assert.ok(!done.isError, JSON.stringify(done));
    const context = decode(
      await client.callTool({
        name: "get_report_context",
        arguments: { date: "2026-09-30", session: "morning", market: "CN_A" },
      }),
    );
    assert.equal(context.report.version, 1);
  } finally {
    await client.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
