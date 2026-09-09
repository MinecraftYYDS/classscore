export interface Student {
  id: number;
  name: string;
  student_no: string;
  score: number;
}

export interface ScoreLog {
  id: number;
  student_id: number;
  student_name?: string;
  delta: number;
  reason: string;
  source: "teacher" | "lottery" | "undo" | "system";
  created_at: number;
}

export type OperationType =
  | "score.adjust"
  | "score.set"
  | "student.add"
  | "student.delete"
  | "student.update"
  | "prize.batch"
  | "lottery.draw"
  | "settings.update"
  | "reset.scores"
  | "data.import"
  | "undo";

export interface Operation {
  id: number;
  type: OperationType;
  summary: string;
  undone: number;
  created_at: number;
}

export interface Prize {
  id: number;
  name: string;
  weight: number;
  stock: number | null;
  color: string;
  enabled: number;
  created_at?: number;
}

export interface LotteryLog {
  id: number;
  student_id: number;
  student_name?: string;
  prize_id: number | null;
  prize_name: string;
  cost: number;
  created_at: number;
}

export interface PresetReason {
  label: string;
  delta: number;
}

export interface WebhookConfig {
  enabled: boolean;
  url: string;
  secret: string;
  events: Record<WebhookEventGroup, boolean>;
}

export type WebhookEventGroup =
  | "student"
  | "score"
  | "lottery"
  | "undo"
  | "settings"
  | "auth"
  | "system";

export interface AppSettings {
  class_name: string;
  initial_score: number;
  lottery_cost: number;
  lottery_min_score: number;
  preset_add: PresetReason[];
  preset_deduct: PresetReason[];
  webhook: WebhookConfig;
}

export interface BoardData {
  className: string;
  students: { id: number; name: string; score: number }[];
  lottery: { cost: number; minScore: number };
}

export interface DrawResult {
  student: { id: number; name: string; score: number };
  prize: Prize;
  actualCost: number;
  newScore: number;
}

export const OPERATION_LABELS: Record<OperationType, string> = {
  "score.adjust": "批量加减分",
  "score.set": "设置分数",
  "student.add": "新增学生",
  "student.delete": "删除学生",
  "student.update": "修改学生",
  "prize.batch": "编辑奖池",
  "lottery.draw": "抽奖",
  "settings.update": "修改设置",
  "reset.scores": "重置分数",
  "data.import": "导入数据",
  undo: "撤销",
};
