// M3.2 /review 委派命令：构造「只读代码审查」worker 的 prompt。
// 审查 worker 在集成候选 worktree 现场跑，连回 Orbit MCP，把结论用 send_message 回灌时间线。

// baseCommit 是集成候选的基线提交；worker 用 `git diff <base> HEAD` 看本次全部改动。
export function buildReviewPrompt(goal: string, baseCommit: string): string {
  return [
    "你正在 Orbit 的集成工作区里，对一次多 Agent 协作的成果做代码审查。这是只读审查任务。",
    `本次协作目标：${goal}`,
    `当前目录是已合并各 Agent 分支的集成候选。运行 \`git diff ${baseCommit} HEAD\` 查看本次的全部改动。`,
    "",
    "请完成：",
    "1) 审查改动的正确性、安全性、可维护性——优先找会导致 bug 的逻辑错误、安全漏洞、明显的坏味道；",
    "2) 这是只读审查：不要修改任何文件，不要 git add / git commit；",
    "3) 审查完，调用 Orbit 的 send_message 工具把结论发出来（to 填 \"all\"，kind 用 \"normal\"），",
    "   按「严重问题 / 改进建议 / 通过项」分点；没有阻断性问题就明确说明「未发现阻断性问题」；",
    "4) 发出消息后即可结束，无需其它动作。",
  ].join("\n");
}
