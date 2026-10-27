import crypto from "node:crypto";

// What AvatarContact asks Gravatar for: a hash of the address, computed on the server, so the address itself never
// leaves MailCheap.
export function gravatarHash(email) {
	return crypto.createHash("sha256").update(String(email ?? "").trim().toLowerCase()).digest("hex");
}
