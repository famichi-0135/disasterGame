import type { Faction } from "@disaster-game/game-core";

export type MatchSession = {
	matchId: string;
	playerToken: string;
	role: Faction;
};

const keyFor = (matchId: string) => `disaster-game:match:${matchId}`;
const latestSessionKey = "disaster-game:latest-match";

export const readMatchSession = (matchId: string): MatchSession | null => {
	if (typeof window === "undefined") return null;
	const value = window.sessionStorage.getItem(keyFor(matchId));
	if (!value) return null;

	try {
		const session = JSON.parse(value) as Partial<MatchSession>;
		if (
			session.matchId === matchId
			&& typeof session.playerToken === "string"
			&& (session.role === "dark" || session.role === "government")
		) {
			return session as MatchSession;
		}
	} catch {
		// 壊れたブラウザ保存値は参加画面へ戻す。
	}

	window.sessionStorage.removeItem(keyFor(matchId));
	return null;
};

export const saveMatchSession = (session: MatchSession): void => {
	if (typeof window === "undefined") return;
	window.sessionStorage.setItem(keyFor(session.matchId), JSON.stringify(session));
	window.sessionStorage.setItem(latestSessionKey, session.matchId);
};

export const readLatestMatchSession = (): MatchSession | null => {
	if (typeof window === "undefined") return null;
	const matchId = window.sessionStorage.getItem(latestSessionKey);
	return matchId ? readMatchSession(matchId) : null;
};

export const clearMatchSession = (matchId: string): void => {
	if (typeof window === "undefined") return;
	window.sessionStorage.removeItem(keyFor(matchId));
	if (window.sessionStorage.getItem(latestSessionKey) === matchId) {
		window.sessionStorage.removeItem(latestSessionKey);
	}
};
