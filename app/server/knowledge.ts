import fs from "node:fs/promises";
import path from "node:path";
import matter from "gray-matter";
import { db, setting, setSetting, hash, byId, now } from "./store.ts";
export async function setRoot(root: string) {
  const actual = await fs.realpath(root);
  if (!(await fs.stat(actual)).isDirectory()) throw new Error("请选择文件夹");
  setSetting("knowledgeRoot", actual);
  return scan();
}
export async function safePath(relative: string) {
  const root = setting("knowledgeRoot", "");
  if (!root) throw new Error("请先设置知识库目录");
  const target = await fs.realpath(path.resolve(root, relative));
  if (target !== root && !target.startsWith(root + path.sep))
    throw new Error("路径超出授权目录");
  return target;
}
export async function scan() {
  const root = setting("knowledgeRoot", "");
  if (!root) return [];
  await fs.access(root);
  const files: string[] = [];
  async function walk(dir: string, depth = 0) {
    if (depth > 15 || files.length > 5000) return;
    for (const e of await fs.readdir(dir, { withFileTypes: true })) {
      if (e.name.startsWith(".") || e.isSymbolicLink()) continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) await walk(p, depth + 1);
      else if (e.name.endsWith(".md")) files.push(path.relative(root, p));
    }
  }
  await walk(root);
  const rows = [];
  for (const file of files) {
    const full = await safePath(file);
    if ((await fs.stat(full)).size > 2_000_000) continue;
    const raw = await fs.readFile(full, "utf8");
    const parsed = matter(raw);
    const title = String(
      parsed.data.title ||
        parsed.content.match(/^#\s+(.+)$/m)?.[1] ||
        path.basename(file, ".md"),
    );
    const tags = Array.isArray(parsed.data.tags)
      ? parsed.data.tags.map(String)
      : [String(parsed.data.tags || path.dirname(file))];
    const date = parsed.data.date
      ? String(
          parsed.data.date instanceof Date
            ? parsed.data.date.toISOString().slice(0, 10)
            : parsed.data.date,
        )
      : "";
    rows.push({
      path: file,
      title,
      tags,
      date,
      status: String(parsed.data.status || "未分类"),
      content: parsed.content,
      hash: hash(raw),
    });
  }
  db.exec("BEGIN IMMEDIATE");
  try {
    db.exec("DELETE FROM knowledge_files");
    const q = db.prepare("INSERT INTO knowledge_files VALUES(?,?,?,?,?,?,?)");
    for (const r of rows)
      q.run(
        r.path,
        r.title,
        JSON.stringify(r.tags),
        r.date,
        r.status,
        r.content,
        r.hash,
      );
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
  return rows;
}
export async function exportNews(
  reportId: string,
  sector: string,
  news: string,
) {
  const r = byId(reportId),
    s = r.sectors.find((s) => s.key === sector),
    n = [...(s?.news || []), ...(s?.supplements || [])].find(
      (n) => n.id === news,
    );
  if (!n) throw new Error("资讯不存在");
  const root = setting("knowledgeRoot", "");
  if (!root) throw new Error("请在设置中选择知识库目录");
  const name = n.title.replace(/[\\/:*?"<>|\n]/g, "-").slice(0, 70);
  const filename = `${r.date}-${name}-${Date.now()}.md`;
  const file = path.join(await fs.realpath(root), filename);
  const data = matter.stringify(
    `# ${n.title}\n\n## 资讯概要\n\n${n.summary}\n\n## AI 解读\n\n${n.ai_analysis || "无"}\n\n## 信息来源\n\n${n.sources.map((s) => `- [${s.name}](${s.url})`).join("\n")}\n\n发布时间：${n.published_at || "未提供"}\n\n保存时间：${now()}\n\n## 我的观点\n\n`,
    {
      title: n.title,
      tags: [s!.name, ...n.tags],
      date: r.date,
      status: "待研究",
      source_urls: n.sources.map((s) => s.url),
    },
  );
  await fs.writeFile(file, data, { flag: "wx" });
  await scan();
  return { path: filename };
}
