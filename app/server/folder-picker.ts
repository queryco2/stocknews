import { execFile } from "node:child_process";
import { promisify } from "node:util";
const execute = promisify(execFile);
let choosing = false;
export async function chooseKnowledgeFolder(): Promise<string | null> {
  if (process.platform !== "darwin") throw new Error("当前文件夹选择弹窗仅支持 macOS");
  if (choosing) throw new Error("文件夹选择窗口已打开");
  choosing = true;
  try {
    const { stdout } = await execute("/usr/bin/osascript", ["-e", 'set selectedFolder to choose folder with prompt "选择 Markdown 或 Obsidian 知识库文件夹"\nreturn POSIX path of selectedFolder'], { timeout: 300000, maxBuffer: 16384 });
    const folder = stdout.replace(/\r?\n$/, "");
    if (!folder.startsWith("/")) throw new Error("未获得有效的文件夹路径");
    return folder;
  } catch (error) {
    if (/\(-128\)/.test(String((error as { stderr?: string }).stderr))) return null;
    throw new Error("无法完成文件夹选择，请重试");
  } finally { choosing = false; }
}
