import assert from "node:assert/strict";
import { test } from "node:test";
import { getEmailProviderId } from "../lib/config.js";
import { getEventPlan } from "../lib/email-event-rules.js";
import { SEND_OUTCOMES, providerError } from "../lib/email-provider/outcomes.js";
import { getRefusalCode, getSendErrorAction, isCustomerRefusal, isPauseForAdmins } from "../lib/sending-rules.js";

test("PostShiba is the provider once its key is set, SES otherwise, and EMAIL_PROVIDER decides when set", () => {
	assert.equal(getEmailProviderId({}), "ses");
	assert.equal(getEmailProviderId({ POSTSHIBA_API_KEY: "ps_key" }), "postshiba");
	assert.equal(getEmailProviderId({ POSTSHIBA_API_KEY: "ps_key", EMAIL_PROVIDER: "ses" }), "ses", "SES stays one switch away");
	assert.equal(getEmailProviderId({ EMAIL_PROVIDER: " PostShiba " }), "postshiba");
	assert.equal(getEmailProviderId({ EMAIL_PROVIDER: "mailgun", POSTSHIBA_API_KEY: "ps_key" }), null, "a typo never picks one");
});

test("provider outcomes become actions; SES errors keep theirs", () => {
	const action = (outcome) => getSendErrorAction(providerError(outcome, outcome));
	assert.equal(action(SEND_OUTCOMES.throttled), "retry");
	assert.equal(action(SEND_OUTCOMES.unavailable), "retry");
	assert.equal(action(SEND_OUTCOMES.suppressed), "suppress");
	assert.equal(action(SEND_OUTCOMES.credentialRefused), "retry", "lib/sending.js pauses on the third refusal within the hour");
	for (const outcome of [SEND_OUTCOMES.domainUnverified, SEND_OUTCOMES.tenantPaused, SEND_OUTCOMES.approvalPending, SEND_OUTCOMES.misconfigured]) {
		assert.equal(action(outcome), "pause", outcome);
	}
	assert.equal(action(SEND_OUTCOMES.failed), "fail");
	assert.equal(action("something new"), "fail");

	const sesError = (name, message = name) => Object.assign(new Error(message), { name });
	assert.equal(getSendErrorAction(sesError("ThrottlingException")), "retry");
	assert.equal(getSendErrorAction(sesError("SendingPausedException")), "pause");
	assert.equal(getSendErrorAction(sesError("MessageRejected", "Email address is not verified.")), "pause");
	assert.equal(getSendErrorAction(sesError("MessageRejected", "Bad content")), "fail");
});

test("only the provider refusing one customer's own domain or sending space blocks that customer, named by its code alone", () => {
	const refused = (outcome, fields) => providerError(outcome, "PostShiba inject: jane@example.com: 550 domain_suspended\nstack traceback:", fields);
	assert.equal(isCustomerRefusal(refused(SEND_OUTCOMES.domainUnverified, { detail: "jane@example.com: 550 domain_suspended" })), true);
	assert.equal(isCustomerRefusal(refused(SEND_OUTCOMES.tenantPaused)), true);
	assert.equal(isCustomerRefusal(refused(SEND_OUTCOMES.tenantPaused, { hold: "operator_hold" })), false, "a hold blocks the whole account instead");
	for (const outcome of [SEND_OUTCOMES.approvalPending, SEND_OUTCOMES.misconfigured, SEND_OUTCOMES.credentialRefused, SEND_OUTCOMES.throttled, SEND_OUTCOMES.failed]) {
		assert.equal(isCustomerRefusal(refused(outcome)), false, outcome);
	}
	const sesError = (name) => Object.assign(new Error(`${name}: for jane@example.com`), { name });
	assert.equal(isCustomerRefusal(sesError("SendingPausedException")), true);
	assert.equal(isCustomerRefusal(sesError("AccountSuspendedException")), false, "the whole AWS account alerts as MailCheap's own");
	assert.equal(isCustomerRefusal(sesError("SenderNotAllowed")), false, "MailCheap's own check, which the owner fixes");

	assert.equal(getRefusalCode(refused(SEND_OUTCOMES.domainUnverified, { detail: "jane@example.com: 550 domain_suspended" })), "domain_suspended");
	assert.equal(getRefusalCode(refused(SEND_OUTCOMES.domainUnverified, { providerCode: "dbl_listed" })), "dbl_listed");
	assert.equal(getRefusalCode(providerError(SEND_OUTCOMES.tenantPaused, "Refused for jane@example.com", { providerCode: "jane@example.com" })), "tenant_paused");
	assert.equal(getRefusalCode(sesError("SendingPausedException")), "SendingPausedException");
});

test("one event shape for every provider: unsubscribes and drops of suppressed addresses", () => {
	const base = { accountId: "64f1a2b3c4d5e6f7a8b9c0d1", messageId: "74f1a2b3c4d5e6f7a8b9c0d2", email: "reader@example.com" };
	const unsubscribe = getEventPlan({ ...base, type: "unsubscribe", recordAs: "unsubscribe" });
	assert.equal(unsubscribe.unsubscribe, true);
	assert.equal(unsubscribe.suppression, null);
	assert.equal(unsubscribe.isRecorded, false);

	const dropped = getEventPlan({ ...base, type: "dropped", error: "Dropped by PostShiba: suppressed", suppressed: true });
	assert.deepEqual(dropped.status, { to: "failed", from: ["queued", "sent"], stat: "failed" });
	assert.deepEqual(dropped.suppression, { emails: ["reader@example.com"], reason: "provider", detail: "Dropped by PostShiba: suppressed", contactStatus: null });
	assert.equal(dropped.isRecorded, true);
	assert.equal(getEventPlan({ ...base, type: "dropped", error: "Invalid" }).suppression, null, "other drops only fail the email");

	assert.equal(getEventPlan({ ...base, type: "bounce", bounce: "soft", reason: "Mailbox full" }).error, "Soft bounce: Mailbox full");
	assert.equal(getEventPlan({ ...base, type: "bounce", bounce: "hard" }).suppression.detail, "bounce");
	assert.equal(getEventPlan({ ...base, type: "complaint", feedback: "not-spam" }).suppression, null);
	assert.equal(getEventPlan({ ...base, type: "deferred" }).status, null);
	assert.equal(getEventPlan({ ...base, type: "processed" }), null, "only normalized types");
	assert.equal(getEventPlan(null), null);
});

test("a provider's pause only an admin lifts, unlike the owner's own login refused or a from address they fix", () => {
	for (const outcome of [SEND_OUTCOMES.domainUnverified, SEND_OUTCOMES.tenantPaused, SEND_OUTCOMES.approvalPending, SEND_OUTCOMES.misconfigured]) {
		assert.equal(isPauseForAdmins(providerError(outcome, outcome)), true, outcome);
	}
	assert.equal(isPauseForAdmins(providerError(SEND_OUTCOMES.credentialRefused, "401")), false, "a resume sends it again");
	const sesError = (name) => Object.assign(new Error(name), { name });
	assert.equal(isPauseForAdmins(sesError("SendingPausedException")), true);
	assert.equal(isPauseForAdmins(sesError("SenderNotAllowed")), false, "MailCheap's own check of their from address");
});
