import { test } from "node:test";
import assert from "node:assert/strict";
import {
  demo,
  nextMeeting,
  previousEntry,
  encryptBackup,
  decryptBackup,
  validateState,
  addMeeting,
  sortMeetings,
} from "../src/model.js";
test("next meeting carries stable identities, excludes closed and preserves original", () => {
  const s = demo(),
    p = s.meetings.at(-1),
    original = JSON.stringify(p),
    next = nextMeeting(p, "2026-10-14", "next");
  assert.equal(next.entries.length, 2);
  assert.equal(next.entries[0].issueId, p.entries[0].issueId);
  assert.equal(next.entries[0].description, "");
  assert.equal(next.entries[0].note, "");
  assert.equal(JSON.stringify(p), original);
  s.meetings.push(next);
  assert.equal(
    previousEntry(s, next.id, next.entries[0].issueId).meeting.id,
    p.id,
  );
});
test("encryption round trip, wrong password and modified data are rejected", async () => {
  const s = demo(),
    encrypted = await encryptBackup(s, "a strong password 123");
  assert.ok(!encrypted.includes(s.meetings[0].entries[0].topic));
  assert.deepEqual(await decryptBackup(encrypted, "a strong password 123"), s);
  await assert.rejects(decryptBackup(encrypted, "incorrect password"));
  const data = JSON.parse(encrypted);
  data.data = (data.data[0] === "A" ? "B" : "A") + data.data.slice(1);
  await assert.rejects(
    decryptBackup(JSON.stringify(data), "a strong password 123"),
  );
  await assert.rejects(encryptBackup(s, "short"));
});
test("restore validates state and rejects duplicate issue identities", () => {
  const s = demo();
  s.meetings[0].entries.push(s.meetings[0].entries[0]);
  assert.throws(() => validateState(s));
});
test("meeting number increments and legacy titles remain compatible", () => {
  const s = demo();
  assert.equal(s.meetings[0].number, 219);
  const n = nextMeeting(s.meetings[1], "2026-10-14", "第 221 次週會");
  assert.equal(n.number, 221);
  assert.deepEqual(n.presentations, []);
  assert.equal(
    nextMeeting({ title: "第 220 次週會", entries: [] }, "2026-10-14", "next")
      .number,
    221,
  );
});
test("encrypted backup preserves per-meeting PPT attachments and old backups still load", async () => {
  const s = demo();
  s.meetings[0].presentations = [
    {
      id: "ppt1",
      name: "weekly.pptx",
      data: "UEsDBA==",
      slides: [{ number: 1, text: "private slide" }],
    },
  ];
  const encrypted = await encryptBackup(s, "attachment strong password");
  assert.ok(!encrypted.includes("private slide"));
  assert.deepEqual(
    await decryptBackup(encrypted, "attachment strong password"),
    s,
  );
  assert.doesNotThrow(() => validateState(demo()));
  s.meetings[0].presentations[0].data = "javascript:invalid";
  assert.throws(() => validateState(s));
});

test("historical meetings insert chronologically and comparisons follow dates", () => {
  const s = demo(),
    id = s.meetings[0].entries[0].issueId;
  addMeeting(s, {
    id: "history218",
    number: 218,
    title: "第 218 次週會",
    date: "2026-09-02",
    entries: [{ issueId: id, description: "older" }],
  });
  addMeeting(s, {
    id: "history217",
    number: 217,
    title: "第 217 次週會",
    date: "2026-08-26",
    entries: [],
  });
  assert.deepEqual(
    s.meetings.map((m) => m.number),
    [217, 218, 219, 220],
  );
  assert.equal(previousEntry(s, s.meetings[2].id, id).meeting.number, 218);
  assert.throws(() =>
    addMeeting(s, {
      id: "duplicate",
      number: 219,
      title: "duplicate",
      date: "2026-01-01",
      entries: [],
    }),
  );
  s.meetings[0].date = "2026-10-14";
  sortMeetings(s);
  assert.equal(s.meetings.at(-1).number, 217);
});

test("text-only historical slides survive encrypted backup without a fake original file", async () => {
  const s = demo();
  s.meetings[0].presentations = [
    {
      id: "text-only",
      name: "old.pptx",
      data: "",
      slides: [
        {
          number: 1,
          text: "歷史內容",
          tables: [[["Topic"], ["Existing topic"]]],
        },
      ],
    },
  ];
  const saved = await encryptBackup(s, "historical strong password");
  const restored = await decryptBackup(saved, "historical strong password");
  assert.equal(restored.meetings[0].presentations[0].data, "");
  assert.equal(
    restored.meetings[0].presentations[0].slides[0].tables[1 - 1][1][0],
    "Existing topic",
  );
});
