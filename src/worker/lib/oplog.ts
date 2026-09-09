export interface AppliedDelta {
  studentId: number;
  name: string;
  before: number;
  after: number;
}

export async function recordOperation(
  db: D1Database,
  type: string,
  summary: string,
  payload: unknown
): Promise<number> {
  const res = await db
    .prepare(
      "INSERT INTO operations (type, summary, payload, undone, created_at) VALUES (?1, ?2, ?3, 0, ?4)"
    )
    .bind(type, summary, JSON.stringify(payload), Date.now())
    .run();
  return Number(res.meta.last_row_id);
}

export interface OperationRow {
  id: number;
  type: string;
  summary: string;
  payload: string;
  undone: number;
  created_at: number;
}

function logStmt(
  db: D1Database,
  studentId: number,
  delta: number,
  reason: string,
  opId: number,
  now: number
): D1PreparedStatement {
  return db
    .prepare(
      "INSERT INTO score_logs (student_id, delta, reason, source, operation_id, created_at) VALUES (?1, ?2, ?3, 'undo', ?4, ?5)"
    )
    .bind(studentId, delta, `撤销:${reason}`, opId, now);
}

function restoreStudents(db: D1Database, students: unknown[]): D1PreparedStatement[] {
  return students.map((s) => {
    const st = s as { id: number; name: string; student_no?: string; score: number; created_at: number };
    return db
      .prepare(
        "INSERT INTO students (id, name, student_no, score, created_at) VALUES (?1, ?2, ?3, ?4, ?5)"
      )
      .bind(st.id, st.name, st.student_no ?? "", st.score, st.created_at);
  });
}

function restoreScoreLogs(db: D1Database, logs: unknown[]): D1PreparedStatement[] {
  return logs.map((l) => {
    const lg = l as { id: number; student_id: number; delta: number; reason: string; source: string; operation_id: number | null; created_at: number };
    return db
      .prepare(
        "INSERT INTO score_logs (id, student_id, delta, reason, source, operation_id, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)"
      )
      .bind(lg.id, lg.student_id, lg.delta, lg.reason, lg.source, lg.operation_id, lg.created_at);
  });
}

function restoreLotteryLogs(db: D1Database, logs: unknown[]): D1PreparedStatement[] {
  return logs.map((l) => {
    const lg = l as { id: number; student_id: number; prize_id: number | null; prize_name: string; cost: number; operation_id: number | null; created_at: number };
    return db
      .prepare(
        "INSERT INTO lottery_logs (id, student_id, prize_id, prize_name, cost, operation_id, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)"
      )
      .bind(lg.id, lg.student_id, lg.prize_id, lg.prize_name, lg.cost, lg.operation_id, lg.created_at);
  });
}

function restorePrizes(db: D1Database, prizes: unknown[]): D1PreparedStatement[] {
  return prizes.map((p) => {
    const pz = p as { id: number; name: string; weight: number; stock: number | null; color: string; enabled: number; created_at: number };
    return db
      .prepare(
        "INSERT INTO prizes (id, name, weight, stock, color, enabled, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)"
      )
      .bind(pz.id, pz.name, pz.weight, pz.stock, pz.color, pz.enabled, pz.created_at ?? Date.now());
  });
}

export async function undoLastOperation(
  db: D1Database
): Promise<{ id: number; type: string; summary: string } | null> {
  const op = await db
    .prepare("SELECT * FROM operations WHERE undone = 0 AND type <> 'undo' ORDER BY id DESC LIMIT 1")
    .first<OperationRow>();
  if (!op) return null;

  let payload: Record<string, unknown> = {};
  try {
    payload = JSON.parse(op.payload);
  } catch {
    /* ignore */
  }
  const now = Date.now();
  const stmts: D1PreparedStatement[] = [];

  switch (op.type) {
    case "score.adjust": {
      const applied = (payload.applied ?? []) as AppliedDelta[];
      const reason = String(payload.reason ?? "");
      for (const a of applied) {
        stmts.push(
          db
            .prepare("UPDATE students SET score = ?1 WHERE id = ?2")
            .bind(a.before, a.studentId)
        );
        stmts.push(logStmt(db, a.studentId, a.before - a.after, reason, op.id, now));
      }
      break;
    }
    case "score.set": {
      stmts.push(
        db
          .prepare("UPDATE students SET score = ?1 WHERE id = ?2")
          .bind(payload.before as number, payload.studentId as number)
      );
      stmts.push(
        logStmt(
          db,
          payload.studentId as number,
          (payload.before as number) - (payload.after as number),
          String(payload.reason ?? ""),
          op.id,
          now
        )
      );
      break;
    }
    case "student.add": {
      const students = (payload.students ?? []) as { id: number; name: string }[];
      const ids = students.map((s) => s.id);
      if (ids.length) {
        const ph = ids.map(() => "?").join(",");
        stmts.push(
          db.prepare(`DELETE FROM score_logs WHERE student_id IN (${ph})`).bind(...ids)
        );
        stmts.push(
          db.prepare(`DELETE FROM lottery_logs WHERE student_id IN (${ph})`).bind(...ids)
        );
        stmts.push(db.prepare(`DELETE FROM students WHERE id IN (${ph})`).bind(...ids));
      }
      break;
    }
    case "student.delete": {
      for (const st of restoreStudents(db, (payload.students ?? []) as unknown[]))
        stmts.push(st);
      for (const lg of restoreScoreLogs(db, (payload.logs ?? []) as unknown[])) stmts.push(lg);
      break;
    }
    case "student.update": {
      const before = payload.before as { name: string; student_no: string };
      stmts.push(
        db
          .prepare("UPDATE students SET name = ?1, student_no = ?2 WHERE id = ?3")
          .bind(before.name, before.student_no, payload.studentId as number)
      );
      break;
    }
    case "prize.batch": {
      stmts.push(db.prepare("DELETE FROM prizes"));
      for (const pz of restorePrizes(db, (payload.before ?? []) as unknown[])) stmts.push(pz);
      break;
    }
    case "lottery.draw": {
      stmts.push(
        db
          .prepare("UPDATE students SET score = score + ?1 WHERE id = ?2")
          .bind(payload.actualCost as number, payload.studentId as number)
      );
      stmts.push(db.prepare("DELETE FROM score_logs WHERE operation_id = ?1").bind(op.id));
      stmts.push(db.prepare("DELETE FROM lottery_logs WHERE operation_id = ?1").bind(op.id));
      if (payload.hadStock && payload.prizeId) {
        stmts.push(
          db
            .prepare("UPDATE prizes SET stock = stock + 1 WHERE id = ?1")
            .bind(payload.prizeId as number)
        );
      }
      break;
    }
    case "settings.update": {
      const changes = (payload.changes ?? []) as { key: string; before: unknown }[];
      for (const ch of changes) {
        if (ch.before === null || ch.before === undefined) {
          stmts.push(db.prepare("DELETE FROM settings WHERE key = ?1").bind(ch.key));
        } else {
          stmts.push(
            db
              .prepare(
                "INSERT INTO settings (key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value = ?2"
              )
              .bind(ch.key, JSON.stringify(ch.before))
          );
        }
      }
      break;
    }
    case "reset.scores": {
      const scores = (payload.scores ?? []) as { id: number; score: number }[];
      for (const s of scores) {
        stmts.push(
          db.prepare("UPDATE students SET score = ?1 WHERE id = ?2").bind(s.score, s.id)
        );
      }
      break;
    }
    case "data.import": {
      stmts.push(db.prepare("DELETE FROM students"));
      stmts.push(db.prepare("DELETE FROM prizes"));
      stmts.push(db.prepare("DELETE FROM score_logs"));
      stmts.push(db.prepare("DELETE FROM lottery_logs"));
      for (const st of restoreStudents(db, (payload.students ?? []) as unknown[]))
        stmts.push(st);
      for (const pz of restorePrizes(db, (payload.prizes ?? []) as unknown[])) stmts.push(pz);
      for (const lg of restoreScoreLogs(db, (payload.scoreLogs ?? []) as unknown[]))
        stmts.push(lg);
      for (const lg of restoreLotteryLogs(db, (payload.lotteryLogs ?? []) as unknown[]))
        stmts.push(lg);
      break;
    }
    default:
      return null;
  }

  stmts.push(db.prepare("UPDATE operations SET undone = 1 WHERE id = ?1").bind(op.id));
  stmts.push(
    db
      .prepare(
        "INSERT INTO operations (type, summary, payload, undone, created_at) VALUES ('undo', ?1, ?2, 0, ?3)"
      )
      .bind(`撤销:${op.summary}`, JSON.stringify({ undoneOpId: op.id, type: op.type }), now)
  );

  await db.batch(stmts);
  return { id: op.id, type: op.type, summary: op.summary };
}
