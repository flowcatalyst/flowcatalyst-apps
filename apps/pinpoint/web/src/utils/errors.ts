export function getErrorMessage(e: unknown, fallback: string): string {
	if (typeof e === "string") return e;
	if (e && typeof e === "object") {
		if ("error" in e && typeof (e as Record<string, unknown>)["error"] === "string") {
			return (e as Record<string, unknown>)["error"] as string;
		}
		if ("message" in e && typeof (e as Record<string, unknown>)["message"] === "string") {
			return (e as Record<string, unknown>)["message"] as string;
		}
	}
	return fallback;
}
