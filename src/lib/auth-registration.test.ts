import assert from "node:assert/strict";
import { validateRegistration } from "./auth-registration.ts";

// Synthetic identifiers only.
const valid = {
    clientId: "11111111-2222-3333-4444-555555555555",
    tenantId: "AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE",
};
assert.deepEqual(validateRegistration(valid), {});
assert.deepEqual(
    validateRegistration({
        clientId: `  ${valid.clientId}\n`,
        tenantId: ` ${valid.tenantId} `,
    }),
    {},
);
assert.deepEqual(validateRegistration({ clientId: "", tenantId: "  " }), {
    clientId: "Application (client) ID is required.",
    tenantId: "Directory (tenant) ID is required.",
});
assert.deepEqual(validateRegistration({ ...valid, clientId: "not-a-guid" }), {
    clientId: "Application (client) ID must be a GUID.",
});
assert.deepEqual(validateRegistration({ ...valid, tenantId: "common" }), {
    tenantId: "Directory (tenant) ID must be a GUID.",
});
for (const malformed of [null, [], 42, "text", { clientId: 7, tenantId: {} }])
    assert.equal(Object.keys(validateRegistration(malformed)).length, 2);
for (const bad of [
    "11111111222233334444555555555555",
    "{11111111-2222-3333-4444-555555555555}",
    "11111111-2222-3333-4444-55555555555Z",
    JSON.stringify(valid),
])
    assert.ok(validateRegistration({ ...valid, clientId: bad }).clientId);
console.log("auth-registration validation self-check OK");
