CREATE TABLE student_groups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL
);

CREATE TABLE student_group_members (
  group_id INTEGER NOT NULL REFERENCES student_groups(id) ON DELETE CASCADE,
  student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  PRIMARY KEY (group_id, student_id)
);
CREATE INDEX idx_group_members_student ON student_group_members(student_id);
