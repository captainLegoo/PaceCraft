import { and, asc, desc, eq } from "drizzle-orm";
import { db } from "../db/client.ts";
import { aiChat } from "../db/schema.ts";
import { AiError, callModel, getAiConfig } from "../ai/provider.ts";
import {
  analyzeRace, buildRacePrompt, PLAN_PROMPT, RESULT_PROMPT, type RaceAnalysis,
} from "./race.ts";

/** 生成一场比赛的完整分析（赛前方案或赛后复盘，取决于日期） */
export async function analyzeRaceDay(opts: {
  date: string;
  goal?: string | null;
  focus?: string | null;
}): Promise<{ analysis: RaceAnalysis; report: string; model: string; roleId: number }> {
  const cfg = getAiConfig();
  if (!cfg) throw new AiError("尚未配置 AI 模型，请先在设置页填写");

  const analysis = analyzeRace({ date: opts.date, goal: opts.goal ?? null });
  if (analysis.mode === "result" && !analysis.found) {
    throw new AiError(`${opts.date} 没有找到训练记录。如果比赛在今天，先同步一次数据再试。`);
  }

  const system = analysis.mode === "result" ? RESULT_PROMPT : PLAN_PROMPT;
  const focus = opts.focus ? `\n\n## 用户特别关注\n${opts.focus}\n` : "";
  const report = await callModel(cfg, system, buildRacePrompt(analysis) + focus);

  const row = db
    .insert(aiChat)
    .values({ scope: "race", refKey: opts.date, role: "assistant", content: report })
    .returning()
    .get();

  return { analysis, report, model: cfg.model, roleId: row.id };
}

/** 针对已有报告追问，模型能看到原始数据 + 之前的对话 */
export async function askFollowUp(opts: {
  date: string;
  goal?: string | null;
  question: string;
}): Promise<{ answer: string; model: string; roleId: number }> {
  const cfg = getAiConfig();
  if (!cfg) throw new AiError("尚未配置 AI 模型，请先在设置页填写");
  if (!opts.question?.trim()) throw new AiError("问题不能为空");

  const analysis = analyzeRace({ date: opts.date, goal: opts.goal ?? null });
  const system = analysis.mode === "result" ? RESULT_PROMPT : PLAN_PROMPT;

  const history = db
    .select()
    .from(aiChat)
    .where(and(eq(aiChat.scope, "race"), eq(aiChat.refKey, opts.date)))
    .orderBy(asc(aiChat.id))
    .all();

  if (history.length === 0) {
    throw new AiError("这场比赛还没有生成过分析，先点「一键分析」再追问");
  }

  db.insert(aiChat).values({ scope: "race", refKey: opts.date, role: "user", content: opts.question }).run();

  // 原始数据 + 之前所有对话，作为单条 user 消息送进去
  const transcript = history.map((h) => `${h.role === "user" ? "运动员" : "教练"}：${h.content}`).join("\n\n");
  const answer = await callModel(
    cfg,
    system,
    `${buildRacePrompt(analysis)}\n\n## 已有对话\n${transcript}\n\n## 运动员的新问题\n${opts.question}\n\n请基于以上数据回答，只回答这一个点。`,
  );

  const row = db
    .insert(aiChat)
    .values({ scope: "race", refKey: opts.date, role: "assistant", content: answer })
    .returning()
    .get();

  return { answer, model: cfg.model, roleId: row.id };
}

export function raceThread(date: string) {
  return db
    .select()
    .from(aiChat)
    .where(and(eq(aiChat.scope, "race"), eq(aiChat.refKey, date)))
    .orderBy(desc(aiChat.id))
    .limit(60)
    .all()
    .reverse();
}

export function clearRaceThread(date: string) {
  db.delete(aiChat).where(and(eq(aiChat.scope, "race"), eq(aiChat.refKey, date))).run();
}
