import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import mongoose from "mongoose";
import { withEnv } from "./helpers/app.mjs";
import { startMongo } from "./helpers/mongo.mjs";

// Where Vercel's runtime puts the current request, with its waitUntil.
const REQUEST_CONTEXT = Symbol.for("@vercel/request-context");
const ON_VERCEL = { VERCEL_URL: "mailcheap.example.com", VERCEL_REGION: "iad1" };

let mongo;
let connectDb;

before(async () => {
	mongo = await startMongo();
	({ connectDb } = await import("../lib/db.js"));
});

after(async () => {
	await mongoose.disconnect();
	await mongo?.stop();
});

test("a first connection that fails is tried again on the next call", async () => {
	const wrongPassword = new URL(mongo.uri);
	wrongPassword.username = "nobody";
	wrongPassword.password = "wrong";
	wrongPassword.searchParams.set("authSource", "admin");
	await withEnv({ MONGODB_URI: wrongPassword.href }, () => assert.rejects(connectDb(), /Authentication failed/));

	await withEnv({ MONGODB_URI: mongo.uri }, () => connectDb());
	assert.equal((await mongoose.connection.db.admin().command({ ping: 1 })).ok, 1);
});

test("on Vercel, a query keeps the instance awake until its idle connections can close", async () => {
	assert.equal(mongoose.connection.getClient().options.maxIdleTimeMS, 5000);

	const waits = [];
	globalThis[REQUEST_CONTEXT] = { get: () => ({ waitUntil: (promise) => waits.push(promise) }) };
	const started = Date.now();
	try {
		await withEnv(ON_VERCEL, () => mongoose.connection.db.admin().command({ ping: 1 }));
	} finally {
		delete globalThis[REQUEST_CONTEXT];
	}
	assert.equal(waits.length, 1, "the request waits before the instance can be suspended");
	await waits[0];
	assert.ok(Date.now() - started >= 5000, "for as long as a connection takes to be idle");
});
