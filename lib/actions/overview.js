import "server-only";
import * as z from "zod";
import { defineAction } from "@/lib/actions/define-action";
import { UsageSchema, findFirstNewsletter, findNewsletter, getUsageOutput, newsletterInput } from "@/lib/actions/shared";
import { getEmailStats, getHourlySends, getSubscriberHistory } from "@/lib/overview-data";
import { PERIOD_DAYS } from "@/lib/overview-series";
import { SUMMARY_BARS, getLatestSummaryPeriod } from "@/lib/summary";
import { summarizeNewsletter } from "@/lib/summary-data";
import { resolveTimeZone } from "@/lib/time-zone";

const STAT_KEYS = ["sent", "delivered", "opened", "clicked", "bounced", "complained"];
const PeriodSchema = z.object({
	...Object.fromEntries(STAT_KEYS.map((key) => [key, z.number().int()])),
	rates: z
		.object({ delivered: z.number().nullable(), opened: z.number().nullable(), clicked: z.number().nullable(), bounced: z.number().nullable(), complained: z.number().nullable() })
		.describe("Fractions from 0 to 1: delivered, bounced and complained of sent; opened and clicked of delivered"),
});

function toRate(part, total) {
	return total ? Math.round((part / total) * 10_000) / 10_000 : null;
}

function toPeriod(stats) {
	const reached = stats.delivered || stats.sent;
	return {
		...Object.fromEntries(STAT_KEYS.map((key) => [key, stats[key] ?? 0])),
		rates: {
			delivered: toRate(stats.delivered, stats.sent),
			opened: toRate(stats.opened, reached),
			clicked: toRate(stats.clicked, reached),
			bounced: toRate(stats.bounced, stats.sent),
			complained: toRate(stats.complained, stats.sent),
		},
	};
}

// An account without a newsletter yet gets the plan's usage and nothing else.
function pickNewsletter(account, reference) {
	const fields = { name: 1, slug: 1 };
	return reference ? findNewsletter(account, reference, fields) : findFirstNewsletter(account, fields);
}

const RateSchema = z.number().nullable().describe("A fraction from 0 to 1 of the contacts the issue reached");

function toSummaryIssue(issue) {
	if (!issue) return null;
	return {
		id: issue.id,
		subject: issue.subject,
		startedAt: new Date(issue.startedAt).toISOString(),
		reached: issue.reached,
		rates: { opened: toRate(issue.opened, issue.reached), clicked: toRate(issue.clicked, issue.reached) },
		average: issue.comparison
			? { issues: issue.comparison.issues, openedDelta: round(issue.comparison.opened), clickedDelta: round(issue.comparison.clicked) }
			: null,
		isSettled: issue.isSettled,
		topLink: issue.topLink,
	};
}

function round(value) {
	return Math.round(value * 10_000) / 10_000;
}

export const overviewActions = [
	defineAction({
		name: "get_overview",
		tryWithoutPlan: true,
		title: "Get the overview",
		group: "Overview",
		description: `The dashboard's overview for one newsletter: subscribers each day of the last ${PERIOD_DAYS} days, email results of the last ${PERIOD_DAYS} days against the ${PERIOD_DAYS} before, emails sent per hour today and yesterday, and the plan's usage this month, which the account's newsletters share.`,
		http: { method: "GET", path: "/overview" },
		readOnly: true,
		example: { timeZone: "Europe/Paris" },
		input: z.object({
			newsletter: newsletterInput,
			timeZone: z.string().max(64).optional().describe("IANA time zone for days and hours, e.g. Europe/Paris. Default: UTC."),
		}),
		output: z.object({
			newsletter: z.object({ id: z.string(), name: z.string(), slug: z.string() }).nullable(),
			timeZone: z.string(),
			subscribers: z
				.object({
					total: z.number().int(),
					growth: z.number().int().describe(`Change over the last ${PERIOD_DAYS} days`),
					previousGrowth: z.number().int().describe(`Change over the ${PERIOD_DAYS} days before`),
					days: z.array(z.object({ date: z.string(), total: z.number().int(), joined: z.number().int(), left: z.number().int() })),
				})
				.nullable(),
			emails: z.object({ current: PeriodSchema, previous: PeriodSchema }).nullable(),
			hours: z
				.array(z.object({ hour: z.number().int(), today: z.number().int().nullable(), yesterday: z.number().int() }))
				.nullable()
				.describe("Emails sent per hour; hours still to come today are null"),
			usage: UsageSchema,
		}),
		handler: async ({ account, input }) => {
			const timeZone = resolveTimeZone(input.timeZone);
			const [newsletter, usage] = await Promise.all([pickNewsletter(account, input.newsletter), getUsageOutput(account)]);
			if (!newsletter) return { newsletter: null, timeZone, subscribers: null, emails: null, hours: null, usage };

			const query = { accountId: account._id, newsletterId: newsletter._id, timeZone };
			const [history, stats, hours] = await Promise.all([getSubscriberHistory(query), getEmailStats(query), getHourlySends(query)]);
			return {
				newsletter: { id: String(newsletter._id), name: newsletter.name, slug: newsletter.slug },
				timeZone,
				subscribers: {
					total: history.total,
					growth: history.growth,
					previousGrowth: history.previousGrowth,
					days: history.current.map(({ key, total, joined, left }) => ({ date: key, total, joined, left })),
				},
				emails: { current: toPeriod(stats.current), previous: toPeriod(stats.previous) },
				hours,
				usage,
			};
		},
	}),
	defineAction({
		name: "get_summary",
		tryWithoutPlan: true,
		title: "Get a summary",
		group: "Overview",
		description: `What MailCheap's summary email says about one newsletter, for its last whole day or week: who joined and who unsubscribed against the period before, the total, new subscribers per day for the last ${SUMMARY_BARS.daily} days or per week for the last ${SUMMARY_BARS.weekly} weeks, the latest issue's open and click rates against the newsletter's average with its most clicked link, and the summary's opening line.`,
		http: { method: "GET", path: "/summary" },
		readOnly: true,
		rateLimit: { limit: 120, window: "1 h" },
		example: { period: "week", timeZone: "Europe/Paris" },
		input: z.object({
			newsletter: newsletterInput,
			period: z.enum(["day", "week"]).optional().describe("day: yesterday. week: the 7 days before the latest Monday. Default: week."),
			timeZone: z.string().max(64).optional().describe("IANA time zone the days start in, e.g. Europe/Paris. Default: UTC."),
		}),
		output: z.object({
			newsletter: z.object({ id: z.string(), name: z.string(), slug: z.string() }).nullable(),
			period: z.object({ from: z.string().describe("First day, YYYY-MM-DD"), to: z.string().describe("Last day, YYYY-MM-DD"), timeZone: z.string() }),
			summary: z
				.object({
					subscribers: z.object({
						joined: z.number().int(),
						previousJoined: z.number().int().nullable(),
						left: z.number().int().describe("Unsubscribes, bounces and complaints"),
						total: z.number().int().describe("Active subscribers at the end of the period"),
						previousTotal: z.number().int().describe("Active subscribers when it started"),
						unsubscribed: z.number().int(),
						previousUnsubscribed: z.number().int(),
						bars: z.array(z.object({ from: z.string(), to: z.string(), joined: z.number().int(), left: z.number().int() })).describe("Oldest first; the last is this period"),
					}),
					issue: z
						.object({
							id: z.string(),
							subject: z.string(),
							startedAt: z.string(),
							reached: z.number().int(),
							rates: z.object({ opened: RateSchema, clicked: RateSchema }),
							average: z
								.object({ issues: z.number().int(), openedDelta: z.number(), clickedDelta: z.number() })
								.nullable()
								.describe("This issue's rates minus the average of the newsletter's earlier issues, as fractions"),
							isSettled: z.boolean().describe("Three days old or more, so its rates stopped climbing"),
							topLink: z.object({ url: z.string(), clickers: z.number().int() }).nullable(),
						})
						.nullable(),
					line: z.string(),
				})
				.nullable(),
		}),
		handler: async ({ account, input }) => {
			const timeZone = resolveTimeZone(input.timeZone);
			const period = getLatestSummaryPeriod({ frequency: input.period === "day" ? "daily" : "weekly", timeZone });
			const range = { from: period.startKey, to: period.lastKey, timeZone };
			const newsletter = await pickNewsletter(account, input.newsletter);
			if (!newsletter) return { newsletter: null, period: range, summary: null };
			const { subscribers, unsubscribed, previousUnsubscribed, issue, line } = await summarizeNewsletter({ account, newsletter, period });
			return {
				newsletter: { id: String(newsletter._id), name: newsletter.name, slug: newsletter.slug },
				period: range,
				summary: {
					subscribers: {
						joined: subscribers.joined,
						previousJoined: subscribers.previousJoined,
						left: subscribers.left,
						total: subscribers.total,
						previousTotal: subscribers.previousTotal,
						unsubscribed,
						previousUnsubscribed,
						bars: subscribers.bars.map((bar) => ({ from: bar.startKey, to: bar.endKey, joined: bar.joined, left: bar.left })),
					},
					issue: toSummaryIssue(issue),
					line,
				},
			};
		},
	}),
];
