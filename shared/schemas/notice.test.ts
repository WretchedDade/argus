import assert from "node:assert/strict";
import { test } from "node:test";
import { NoticeSchema, NoticesResponseSchema, type Notice } from "./notice.ts";

const notice: Notice = {
    id: "app-update:1.2.3",
    kind: "app-update",
    title: "Update",
    detail: "A new version is ready.",
    actionLabel: "Update",
};

test("NoticeSchema accepts a valid Notice", () => {
    assert.deepEqual(NoticeSchema.parse(notice), notice);
});

test("NoticeSchema rejects a bad kind and a missing field", () => {
    assert.equal(
        NoticeSchema.safeParse({ ...notice, kind: "other" }).success,
        false,
    );
    const { title: _title, ...missing } = notice;
    assert.equal(NoticeSchema.safeParse(missing).success, false);
});

test("NoticesResponseSchema rejects a malformed list", () => {
    assert.equal(
        NoticesResponseSchema.safeParse({ notices: [{}] }).success,
        false,
    );
    assert.equal(
        NoticesResponseSchema.parse({ notices: [notice] }).notices.length,
        1,
    );
});
