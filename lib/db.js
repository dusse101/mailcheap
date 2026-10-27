import { attachDatabasePool } from "@vercel/functions";
import mongoose from "mongoose";

const cached = globalThis.__mailcheapMongoose ?? { connection: null, promise: null };
globalThis.__mailcheapMongoose = cached;

export async function connectDb() {
	if (cached.connection) return cached.connection;
	if (!process.env.MONGODB_URI) throw new Error("MONGODB_URI is not set");

	// Each Vercel instance has a pool of its own, and a suspended instance keeps its sockets open: idle connections
	// close after 5 seconds, and attachDatabasePool keeps the instance awake that long after its last query. It does
	// nothing off Vercel.
	cached.promise ??= mongoose
		.connect(process.env.MONGODB_URI, {
			maxPoolSize: 10,
			maxIdleTimeMS: 5000,
			serverSelectionTimeoutMS: 5000,
		})
		.then((connected) => {
			attachDatabasePool(connected.connection.getClient());
			return connected;
		})
		.catch((error) => {
			cached.promise = null;
			throw error;
		});
	cached.connection = await cached.promise;
	return cached.connection;
}
