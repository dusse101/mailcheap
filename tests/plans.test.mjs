import assert from "node:assert/strict";
import { test } from "node:test";
import {
	ERROR_CODES,
	getAccountSendProblem,
	getAccountStatus,
	getPlanLimitProblem,
	hasActiveSubscription,
	isPaidStatus,
} from "../lib/account-state.js";
import {
	PLANS,
	getAccountLimits,
	getAccountPlan,
	getLookupKey,
	getPlan,
	getPrice,
	getSignupScale,
	isOnFreePlan,
	parseLookupKey,
	readInterval,
	scaleSignupLimit,
} from "../lib/plans.js";

// Plans and the paywall are MailCheap Cloud's; the last test is a self-hosted server.
process.env.MAILCHEAP_CLOUD = "true";

function selfHosted(run) {
	process.env.MAILCHEAP_CLOUD = "";
	try {
		return run();
	} finally {
		process.env.MAILCHEAP_CLOUD = "true";
	}
}

test("the six plans match the spec: prices, emails a month and subscribers, yearly at 10 months", () => {
	assert.deepEqual(
		PLANS.map((plan) => [plan.id, plan.name, getPrice(plan, "month"), getPrice(plan, "year"), plan.emailsPerMonth, plan.subscribers]),
		[
			["starter", "Starter", 19, 190, 20_000, 10_000],
			["growth", "Growth", 39, 390, 75_000, 40_000],
			["pro", "Pro", 79, 790, 200_000, 100_000],
			["scale", "Scale", 149, 1_490, 500_000, 250_000],
			["max", "Max", 349, 3_490, 2_000_000, 1_000_000],
			["ultra", "Ultra", 799, 7_990, 5_000_000, 2_500_000],
		]
	);
	assert.equal(getPlan("max").name, "Max");
	assert.equal(getPlan("ultra").name, "Ultra");
});

test("Stripe lookup keys name the plan and the interval, both ways", () => {
	assert.equal(getLookupKey("growth", "month"), "mailcheap_growth_monthly");
	assert.equal(getLookupKey("scale", "year"), "mailcheap_scale_yearly");
	assert.equal(getLookupKey("max", "month"), "mailcheap_max_monthly");
	assert.deepEqual(parseLookupKey("mailcheap_max_yearly"), { plan: "max", interval: "year" });
	assert.equal(getLookupKey("ultra", "year"), "mailcheap_ultra_yearly");
	assert.deepEqual(parseLookupKey("mailcheap_ultra_monthly"), { plan: "ultra", interval: "month" });
	for (const plan of PLANS) {
		for (const interval of ["month", "year"]) {
			assert.deepEqual(parseLookupKey(getLookupKey(plan.id, interval)), { plan: plan.id, interval });
		}
	}
	for (const key of [null, "", "growth_monthly", "mailcheap_enterprise_monthly", "mailcheap_pro_weekly", "mailcheap_pro_monthly_v2"]) {
		assert.equal(parseLookupKey(key), null, String(key));
	}
	assert.equal(readInterval("year"), "year");
	assert.equal(readInterval("decade"), "month");
});

test("an admin's numbers replace the plan's", () => {
	assert.deepEqual(getAccountLimits({ plan: "pro" }), { emails: 200_000, subscribers: 100_000 });
	assert.deepEqual(getAccountLimits({ plan: "max" }), { emails: 2_000_000, subscribers: 1_000_000 });
	assert.deepEqual(getAccountLimits({ plan: "max", limitOverrides: { emailsPerMonth: 3_000_000 } }), { emails: 3_000_000, subscribers: 1_000_000 });
	assert.deepEqual(getAccountLimits({ plan: "pro", limitOverrides: { emailsPerMonth: 1_000 } }), {
		emails: 1_000,
		subscribers: 100_000,
	});
	assert.deepEqual(getAccountLimits({ plan: "starter", limitOverrides: { emailsPerMonth: 0, subscribers: 9 } }), {
		emails: 0,
		subscribers: 9,
	});
	assert.deepEqual(getAccountLimits({}), { emails: 0, subscribers: 0 }, "no plan, no sending");
});

test("active, trialing and past_due subscriptions keep the account working", () => {
	for (const status of ["active", "trialing", "past_due"]) assert.equal(hasActiveSubscription({ subscriptionStatus: status }), true);
	for (const status of [undefined, "incomplete", "incomplete_expired", "canceled", "unpaid", "paused"]) {
		assert.equal(hasActiveSubscription({ subscriptionStatus: status }), false, String(status));
	}
	assert.equal(getAccountStatus({}), "no_plan");
	assert.equal(getAccountStatus({ subscriptionStatus: "active", status: "paused" }), "blocked");
	assert.equal(getAccountStatus({ subscriptionStatus: "canceled", status: "paused" }), "canceled");
	assert.equal(getAccountStatus({ subscriptionStatus: "past_due" }), "past_due");
});

test("a free plan from an admin works like a paid one until its end; a paid plan and the admin's numbers win", () => {
	const day = 86_400_000;
	const comp = { plan: "scale", grantedAt: new Date(Date.now() - day), by: "admin@example.com" };
	const free = { comp };
	assert.equal(hasActiveSubscription(free), true);
	assert.equal(isOnFreePlan(free), true);
	assert.equal(getAccountStatus(free), "active");
	assert.equal(getAccountSendProblem(free), null);
	assert.deepEqual(getAccountLimits(free), { emails: 500_000, subscribers: 250_000 });
	assert.deepEqual(getAccountLimits({ ...free, limitOverrides: { subscribers: 7 } }), { emails: 500_000, subscribers: 7 });
	assert.equal(getAccountStatus({ ...free, status: "paused" }), "blocked");
	assert.equal(getAccountSendProblem({ ...free, status: "paused" }).code, ERROR_CODES.accountBlocked, "a free plan doesn't lift a block");

	const canceled = { plan: "starter", subscriptionStatus: "canceled", comp };
	assert.equal(getAccountPlan(canceled).id, "scale", "the last paid plan ended: the free one counts");
	assert.equal(getAccountStatus(canceled), "active");

	const paid = { plan: "growth", subscriptionStatus: "active", comp };
	assert.equal(isOnFreePlan(paid), false);
	assert.equal(getAccountPlan(paid).id, "growth", "the paid plan is in charge");
	assert.deepEqual(getAccountLimits(paid), { emails: 75_000, subscribers: 40_000 });

	const ended = { comp: { ...comp, until: new Date(Date.now() - 1000) } };
	assert.equal(hasActiveSubscription(ended), false);
	assert.equal(getAccountStatus(ended), "no_plan");
	assert.deepEqual(getAccountLimits(ended), { emails: 0, subscribers: 0 });
	assert.equal(hasActiveSubscription({ comp: { ...comp, until: new Date(Date.now() + day) } }), true, "an end date still ahead");
	assert.equal(hasActiveSubscription({ comp, deletion: { requestedAt: new Date() } }), false, "an account waiting to be deleted");
	assert.equal(hasActiveSubscription({ comp: { ...comp, plan: "enterprise" } }), false, "only the six plans");
	assert.deepEqual(getAccountLimits({ comp: { ...comp, plan: "max" } }), { emails: 2_000_000, subscribers: 1_000_000 }, "a free Max");
	assert.deepEqual(getAccountLimits({ comp: { ...comp, plan: "ultra" } }), { emails: 5_000_000, subscribers: 2_500_000 }, "a free Ultra");
});

test("every send needs a plan and an account that isn't blocked", () => {
	assert.equal(getAccountSendProblem({}).code, ERROR_CODES.subscriptionRequired);
	assert.equal(getAccountSendProblem({ subscriptionStatus: "canceled" }).code, "subscription_required");
	const blocked = getAccountSendProblem({ subscriptionStatus: "active", status: "paused", pauseReason: "An email reached a spam trap." });
	assert.equal(blocked.code, "account_blocked");
	assert.equal(blocked.message, "This account is blocked: An email reached a spam trap. Chat with us to unblock it.");
	assert.equal(getAccountSendProblem({ status: "paused" }).code, "account_blocked", "the block comes before the plan");
	assert.equal(getAccountSendProblem({ subscriptionStatus: "active", status: "active" }), null);
});

test("a send is blocked when it would pass the month's emails or the account is over its subscribers", () => {
	const account = { plan: "starter", subscriptionStatus: "active" };
	const fits = { account, emailsSent: 15_000, queued: 0, recipients: 5_000, activeContacts: 10_000 };
	assert.equal(getPlanLimitProblem(fits), null, "exactly the emails left, exactly the subscriber limit");

	const tooMany = getPlanLimitProblem({ ...fits, recipients: 5_001 });
	assert.equal(tooMany.code, ERROR_CODES.planLimitEmails);
	assert.equal(tooMany.message, "This send needs 5,001 emails and your plan has 5,000 left this month. Upgrade to send.");

	assert.equal(getPlanLimitProblem({ ...fits, queued: 1 }).code, "plan_limit_emails", "emails still going out count");
	const overList = getPlanLimitProblem({ ...fits, recipients: 1, activeContacts: 10_001 });
	assert.equal(overList.code, ERROR_CODES.planLimitSubscribers);
	assert.match(overList.message, /10,001 subscribers and your plan allows 10,000/);

	const overridden = { ...account, limitOverrides: { emailsPerMonth: 30_000 } };
	assert.equal(getPlanLimitProblem({ ...fits, account: overridden, recipients: 15_000 }), null);
	assert.equal(getPlanLimitProblem({ ...fits, emailsSent: 25_000 }).message.includes("has 0 left"), true, "never negative");
});

test("Max sends 2,000,000 emails a month to up to 1,000,000 subscribers: a weekly issue to about 460,000", () => {
	const account = { plan: "max", subscriptionStatus: "active" };
	const fits = { account, emailsSent: 1_500_000, queued: 0, recipients: 500_000, activeContacts: 1_000_000 };
	assert.equal(getPlanLimitProblem(fits), null, "exactly the emails left, exactly the subscriber limit");
	assert.equal(getPlanLimitProblem({ ...fits, recipients: 500_001 }).code, ERROR_CODES.planLimitEmails);
	assert.equal(getPlanLimitProblem({ ...fits, recipients: 1, activeContacts: 1_000_001 }).code, ERROR_CODES.planLimitSubscribers);
	assert.ok(Math.ceil(460_000 * 4.33) <= getAccountLimits(account).emails, "about 4.33 issues a month to 460,000");
	assert.ok(Math.ceil(470_000 * 4.33) > getAccountLimits(account).emails, "not to 470,000");
});

test("Ultra sends 5,000,000 emails a month to up to 2,500,000 subscribers: a weekly issue to about 1,150,000", () => {
	const account = { plan: "ultra", subscriptionStatus: "active" };
	const fits = { account, emailsSent: 2_500_000, queued: 0, recipients: 2_500_000, activeContacts: 2_500_000 };
	assert.equal(getPlanLimitProblem(fits), null, "exactly the emails left, exactly the subscriber limit");
	assert.equal(getPlanLimitProblem({ ...fits, recipients: 2_500_001 }).code, ERROR_CODES.planLimitEmails);
	assert.equal(getPlanLimitProblem({ ...fits, recipients: 1, activeContacts: 2_500_001 }).code, ERROR_CODES.planLimitSubscribers);
	assert.ok(Math.ceil(1_150_000 * 4.33) <= getAccountLimits(account).emails, "about 4.33 issues a month to 1,150,000");
	assert.ok(Math.ceil(1_160_000 * 4.33) > getAccountLimits(account).emails, "not to 1,160,000");
});

test("self-hosted, without MAILCHEAP_CLOUD: no paywall, no plan limits, every account active unless blocked", () => {
	for (const value of [undefined, "", "false", "1", "TRUE"]) {
		if (value === undefined) delete process.env.MAILCHEAP_CLOUD;
		else process.env.MAILCHEAP_CLOUD = value;
		assert.equal(hasActiveSubscription({}), true, `MAILCHEAP_CLOUD=${value}`);
	}
	process.env.MAILCHEAP_CLOUD = "true";

	selfHosted(() => {
		for (const status of [undefined, "canceled", "unpaid"]) assert.equal(hasActiveSubscription({ subscriptionStatus: status }), true, String(status));
		assert.equal(isPaidStatus("canceled"), false, "Stripe's statuses keep their meaning for the billing code");
		assert.equal(getAccountStatus({}), "active");
		assert.equal(getAccountStatus({ subscriptionStatus: "canceled", status: "paused" }), "blocked");
		assert.equal(getAccountSendProblem({}), null);
		const blocked = getAccountSendProblem({ status: "paused" });
		assert.equal(blocked.code, ERROR_CODES.accountBlocked, "the blocks stay");
		assert.equal(blocked.message, "This account is blocked. An admin can unblock it on the admin page.");
		assert.equal(getAccountLimits({ plan: "starter", limitOverrides: { emailsPerMonth: 1 } }), null);
		const huge = { account: {}, emailsSent: 50_000_000, queued: 1_000_000, recipients: 2_000_000, activeContacts: 3_000_000 };
		assert.equal(getPlanLimitProblem(huge), null);
	});
	assert.equal(getAccountSendProblem({}).code, ERROR_CODES.subscriptionRequired, "back on MailCheap Cloud");
});

test("signup limits grow with the plan, from Starter's; a self-hosted server gets the largest plan's", () => {
	assert.deepEqual(
		PLANS.map(({ id, signupScale }) => [id, signupScale]),
		[
			["starter", 1],
			["growth", 2],
			["pro", 5],
			["scale", 10],
			["max", 25],
			["ultra", 50],
		]
	);
	assert.equal(getSignupScale({ plan: "growth", subscriptionStatus: "active" }), 2);
	assert.equal(getSignupScale({ plan: "ultra", subscriptionStatus: "active" }), 50);
	assert.equal(getSignupScale({ plan: "starter", comp: { plan: "max", grantedAt: new Date() } }), 25, "a free plan an admin gave");
	assert.equal(getSignupScale({}), 1, "without a plan, Starter's");
	const perKey = { name: "api-contacts-key", limit: 600, window: "1 h" };
	assert.deepEqual(scaleSignupLimit(perKey, { plan: "pro" }), { ...perKey, limit: 3000 });
	assert.equal(perKey.limit, 600, "the base stays as it is");
	selfHosted(() => assert.equal(getSignupScale({}), 50));
});
