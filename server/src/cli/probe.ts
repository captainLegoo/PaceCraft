import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DATA_DIR } from "../config.ts";
import { callTool, describeTool, listTools } from "../coros/mcp.ts";

const OUT = join(DATA_DIR, "probe");
mkdirSync(OUT, { recursive: true });

const target = process.argv[2] ?? "schema";

async function dumpSchemas() {
  const tools = await listTools(true);
  const doc: Record<string, unknown> = {};
  for (const t of tools) {
    doc[t.name] = {
      description: t.description,
      required: (t.inputSchema as any)?.required ?? [],
      properties: Object.fromEntries(
        Object.entries((t.inputSchema as any)?.properties ?? {}).map(([k, v]: [string, any]) => [
          k,
          { type: v.type, description: v.description, enum: v.enum, default: v.default },
        ]),
      ),
    };
  }
  writeFileSync(join(OUT, "tools.json"), JSON.stringify(doc, null, 2));
  console.log(`✅ ${tools.length} 个工具 schema 已导出 → ${join(OUT, "tools.json")}`);
  for (const t of tools) {
    const req = (t.inputSchema as any)?.required ?? [];
    const props = Object.keys((t.inputSchema as any)?.properties ?? {});
    console.log(`  ${t.name.padEnd(34)} required=[${req.join(",")}] props=[${props.join(",")}]`);
  }
}

async function dumpCall(name: string, args: Record<string, unknown>) {
  const schema = await describeTool(name);
  if (!schema) throw new Error(`tool not found: ${name}`);
  writeFileSync(join(OUT, `${name}.schema.json`), JSON.stringify(schema, null, 2));
  const text = await callTool(name, args);
  const file = join(OUT, `${name}.txt`);
  writeFileSync(file, text);
  console.log(`\n${"=".repeat(78)}\n### ${name}(${JSON.stringify(args)})\n${"=".repeat(78)}`);
  console.log(text.length > 4000 ? text.slice(0, 4000) + "\n...[截断] → " + file : text);
  console.log(`\n(完整内容 ${text.length} 字符 → ${file})`);
}

if (target === "schema") {
  await dumpSchemas();
} else {
  const args = process.argv[3] ? JSON.parse(process.argv[3]) : {};
  await dumpCall(target, args);
}
